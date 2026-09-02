const port = 5678;
(() => {
  console.info('========== Fiddler-everywhere-enhance start ==========')
  const { app, BrowserWindow } = require('electron')
  const path = require('path')
  const fs = require('fs')
  const sp = require('child_process')

  const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf-8'))
  const resourceRoots = [
    path.resolve(__dirname, '..'),
    path.resolve(__dirname, '../../app.asar.unpacked'),
  ]

  const patchBinaryFile = (filePath, patcher, backupSuffix) => {
    if (!fs.existsSync(filePath)) {
      console.info('Patch target does not exist:', filePath)
      return
    }
    const original = fs.readFileSync(filePath)
    const file = Buffer.from(original)
    const changed = patcher(file)
    if (!changed) {
      return
    }
    const backupPath = `${filePath}${backupSuffix}`
    if (!fs.existsSync(backupPath)) {
      fs.copyFileSync(filePath, backupPath)
      console.info('Backup:', backupPath)
    }
    fs.writeFileSync(filePath, file)
    console.info('Patched:', filePath)
  }

  const patchWebUi = (file) => {
    let changed = false

    // FE 8.1.0 checks these two files during startup and returns exit code
    // 252 when the application was unpacked without app.asar. Both methods
    // have the signature bool Method(out string error). Return true and clear
    // the out parameter, while keeping the original method-body span.
    const startupMethods = [
      {
        name: 'TryOpenClientMainScript',
        original: Buffer.from('1b3006007009000087050011', 'hex'),
        codeSize: 0x970,
      },
      {
        name: 'TryOpenElectronMainScript',
        original: Buffer.from('1b3006007807000088050011', 'hex'),
        codeSize: 0x778,
      },
    ]
    const startupBody = Buffer.from('16021451172a', 'hex')
    for (const method of startupMethods) {
      const pos = file.indexOf(method.original)
      if (pos < 0) {
        if (file.indexOf(startupBody) >= 0) {
          console.info(`${method.name} patch already applied`)
        } else {
          console.warn(`${method.name} pattern not found`)
        }
        continue
      }
      const span = 12 + method.codeSize
      startupBody.copy(file, pos)
      file.fill(0, pos + startupBody.length, pos + span)
      changed = true
      console.info(`Patched ${method.name} at 0x${pos.toString(16)}`)
    }

    // Disable the 15-minute integrity-check hosted service. The 8.1.0
    // method is a fat body with a 202-byte IL stream and uses MemberRef
    // 0x0A0000AB for Task.get_CompletedTask.
    const integrityOriginal = Buffer.from('13300300ca00000011010011', 'hex')
    const integrityBody = Buffer.from('1a28ab00000a2a', 'hex')
    const integrityPos = file.indexOf(integrityOriginal)
    if (integrityPos >= 0) {
      const span = 12 + 0xca
      integrityBody.copy(file, integrityPos)
      file.fill(0, integrityPos + integrityBody.length, integrityPos + span)
      changed = true
      console.info(`Patched IntegrityCheckService.ExecuteAsync at 0x${integrityPos.toString(16)}`)
    } else if (file.indexOf(integrityBody) >= 0) {
      console.info('IntegrityCheckService.ExecuteAsync patch already applied')
    } else {
      console.warn('IntegrityCheckService.ExecuteAsync pattern not found')
    }
    return changed
  }

  const patchBackendSdk = (file) => {
    let changed = false
    const cfgList = [
      {
        from: '6100700069002e0067006500740066006900640064006c00650072002e0062006500',
        to: '3100320037002e0030002e0030002e00310000000000000000000000000000000000',
      },
      {
        from: 'FF11001F118D3700000125',
        to: 'FF11001F098D3700000125',
      },
      {
        from: '6900640065006e0074006900740079002e0067006500740066006900640064006c00650072002e0062006500',
        to: '3100320037002e0030002e0030002e0031000000000000000000000000000000000000000000000000000000',
      },
      {
        from: '0011001F168D3700000125',
        to: '0011001F098D3700000125',
      },
    ]

    // The old patch assumed a fixed MemberRef token. FE 8.1.0 rebuilt its
    // metadata and changed that token, so locate the instruction shape.
    const findSignatureBranch = (firstByte) => {
      const positions = []
      for (let i = 0; i + 13 < file.length; i++) {
        if (file[i] !== firstByte || file[i + 1] !== 0x2a || file[i + 2] !== 0x28) {
          continue
        }
        const firstCall = file.readUInt32LE(i + 3)
        const secondCall = file.readUInt32LE(i + 8)
        if ((firstCall >>> 24) !== 0x0a || file[i + 7] !== 0x28 ||
            (secondCall >>> 24) !== 0x0a || file[i + 12] !== 0x13) {
          continue
        }
        positions.push(i)
      }
      return positions
    }

    const patchedSignature = findSignatureBranch(0x17)
    const originalSignature = findSignatureBranch(0x16)
    if (patchedSignature.length > 0) {
      console.info(`Signature whitelist patch already applied at ${patchedSignature.map(x => `0x${x.toString(16)}`).join(', ')}`)
    } else if (originalSignature.length === 1) {
      file[originalSignature[0]] = 0x17
      changed = true
      console.info(`Patched signature whitelist branch at 0x${originalSignature[0].toString(16)}`)
    } else if (originalSignature.length === 0) {
      console.warn('Signature whitelist branch not found')
    } else {
      console.warn(`Found ${originalSignature.length} possible signature whitelist branches; skipped`)
    }

    for (const cfg of cfgList) {
      const from = Buffer.from(cfg.from, 'hex')
      const to = Buffer.from(cfg.to, 'hex')
      const pos = file.indexOf(from)
      if (pos < 0) {
        if (file.indexOf(to) >= 0) {
          console.info(`Backend patch already applied for ${cfg.from}`)
        } else {
          console.warn(`Backend patch pattern not found: ${cfg.from}`)
        }
        continue
      }
      to.copy(file, pos)
      changed = true
      console.info(`Backend patch applied at 0x${pos.toString(16)}: ${cfg.from}`)
    }

    const hostWhitelistPatches = [
      {
        name: 'NotifySetConfiguration host whitelist',
        from: Buffer.from('7e1200000411006f2d00000a392e000000', 'hex'),
        to: Buffer.from('3821000000000000000000000000000000', 'hex'),
      },
    ]
    for (const cfg of hostWhitelistPatches) {
      const pos = file.indexOf(cfg.from)
      if (pos >= 0) {
        cfg.to.copy(file, pos)
        changed = true
        console.info(`Backend host whitelist patch applied for ${cfg.name} at 0x${pos.toString(16)}`)
      } else if (file.indexOf(cfg.to) >= 0) {
        console.info(`Backend host whitelist patch already applied for ${cfg.name}`)
      } else {
        console.warn(`Backend host whitelist pattern not found: ${cfg.name}`)
      }
    }
    return changed
  }

  const mainXHandle = {
    replace: () => {
      // 修改mian-xxx.js文件
      console.info('Modify main-XXXXXXX.js (Or main.XXXXXXXXXXXXX.js in old versions)')
      const index = fs.readFileSync(path.resolve(__dirname, './WebServer/ClientApp/dist/index.html')).toString()
      const match = index.match(/main.*?\.js/)
      const mainXJsPath = path.resolve(__dirname, `./WebServer/ClientApp/dist/${match}`)
      let mainXJs = fs.readFileSync(mainXJsPath).toString()
      // FE 8.1.0 may spell these endpoints with either ".com" or ".be".
      // Always use a local URL with the original host in the path; this does
      // not require a system hosts-file modification.
      mainXJs = mainXJs.replace(/https:\/\/api\.getfiddler\.(?:com|be)/g, `http://127.0.0.1:${port}/api.getfiddler.com`)
      mainXJs = mainXJs.replace(/https:\/\/identity\.getfiddler\.(?:com|be)/g, `http://127.0.0.1:${port}/identity.getfiddler.com`)
      // "https://","api",".get","fiddler",".com"
      mainXJs = mainXJs.replace(new RegExp(`"https://","api",".get","fiddler","\\.(?:com|be)"`, 'g'), `"http://127.0.0.1:${port}/","api",".get","fiddler",".com"`)
      mainXJs = mainXJs.replace(new RegExp(`"https://","identity",".get","fiddler","\\.(?:com|be)"`, 'g'), `"http://127.0.0.1:${port}/","identity",".get","fiddler",".com"`)

      fs.writeFileSync(mainXJsPath, mainXJs)
    },
    reset: () => {
      // 还原mian-xxx.js文件
      console.info('Recover main-XXXXXXX.js (Or main.XXXXXXXXXXXXX.js in old versions)')
      const index = fs.readFileSync(path.resolve(__dirname, './WebServer/ClientApp/dist/index.html')).toString()
      const match = index.match(/main.*?\.js/)
      console.info('Match result:', match)
      const mainXJsPath = path.resolve(__dirname, `./WebServer/ClientApp/dist/${match}`)
      let mainXJs = fs.readFileSync(mainXJsPath).toString()
      mainXJs = mainXJs.replace(new RegExp(`http://127\\.0\\.0\\.1:\\d+/`, 'g'), 'https://')
      mainXJs = mainXJs.replace(new RegExp(`"http://","api"`, 'g'), '"https://","api"')
      mainXJs = mainXJs.replace(new RegExp(`"http://","identity"`, 'g'), '"https://","identity"')
      mainXJs = mainXJs.replace(new RegExp(`",".get","fiddler","\\.be(?::\\d+)?"`, 'g'), `",".get","fiddler",".com"`)
      fs.writeFileSync(mainXJsPath, mainXJs)
    }
  }
  const originalSpwan = sp.spawn
  sp.spawn = function(...args) {
    console.info('Call spwan:', args[0])
    if (args[0].includes('Fiddler.WebUi'))
    {
      mainXHandle.reset()
    }
    /**@type {dV.ChildProcessWithoutNullStreams} */
    const result = originalSpwan.apply(this, args)
    return result
  }

  const originalBrowserWindow = BrowserWindow;

  const hookBrowserWindow = (OriginalBrowserWindow) => {
    function HookedBrowserWindow(options) {
      // 修改或增加构造函数的选项
      try {
        if (options) {
          options.frame = false
          if (options.webPreferences) {
            options.webPreferences.devTools = true
            const p = path.resolve(__dirname, './translate.js')
            if (fs.existsSync(p)) {
              // 如果存在translate.js文件，则使用它
              options.webPreferences.preload = p
            }
          }
        }
        console.info('HookedBrowserWindow:', options)
      }catch(e) {

      }
      // 使用修改后的选项调用原始构造函数
      return new OriginalBrowserWindow(options);
    }

    // 复制原始构造函数的原型链并进行替换
    HookedBrowserWindow.prototype = Object.create(OriginalBrowserWindow.prototype);
    HookedBrowserWindow.prototype.constructor = HookedBrowserWindow;
    Object.setPrototypeOf(HookedBrowserWindow, OriginalBrowserWindow);

    return HookedBrowserWindow;
  };

  // 使用替换的构造函数
  const HookedBrowserWindow = hookBrowserWindow(originalBrowserWindow);

  const ModuleLoadHook = {
    electron: (module) => {
      return {
        ...module,
        BrowserWindow: HookedBrowserWindow
      }
    },
  }
  const { Module } = require("module");
  const original_load = Module._load;
  // console.log('Module:', Module)
  Module._load = (...args) => {
    const loaded_module = original_load(...args);
    // console.log('load', args[0])
    if (ModuleLoadHook[args[0]]) {
      return ModuleLoadHook[args[0]](loaded_module)
    }
    else {
      return loaded_module;
    }
  }
  
  // hook loadURL
  const originloadURL = BrowserWindow.prototype.loadURL;
  BrowserWindow.prototype.loadURL = function(...args){
    this.setMinimumSize(300, 300);
    // this.webContents.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) bilibili_pc/1.9.1 Chrome/98.0.4758.141 Electron/17.4.11 Safari/537.36')
    console.info('Call loadURL', args)
    // DevTools切换
    this.webContents.on("before-input-event", (event, input) => {
      if (input.key === "F12" && input.type === "keyUp") {
        this.webContents.toggleDevTools();
      }
    });
    this.webContents.on("did-finish-load", (event, input) => {
      mainXHandle.reset()
      this.webContents.executeJavaScript(`{
        const originalSome = Array.prototype.some
        Array.prototype.some = function(...args) {
          const t = args[0]
          args[0] = function(e) {
            const v = e
            if (
              v[0] == 48
              && v[1] == 89
              && v[2] == 48
              && v[3] == 19
            ) {
              return true
            }
            return t(e)
          }
          return originalSome.apply(this, args)
        }
      }`)
    });
    if (args[0].includes('index.html'))
    {
      mainXHandle.replace()
    }
    return originloadURL.apply(this, args)
  };

  // version 8.x
  if (Number(pkg.version.split('.')[0]) >= 8){
    for (const root of resourceRoots) {
      patchBinaryFile(
        path.join(root, 'out', 'WebServer', 'FiddlerBackendSDK.dll'),
        patchBackendSdk,
        '.bak-signing',
      )
      patchBinaryFile(
        path.join(root, 'out', 'WebServer', 'Fiddler.WebUi.dll'),
        patchWebUi,
        '.bak-startup-check',
      )
    }
    const U = global.URL
    global.URL = class extends U {
      constructor(u, base) {
        super(u, base)
        console.info('new URL -> ', u)
        if (u.includes('http://') && u.includes('getfiddler') && (u.endsWith('.com') || u.endsWith(`:${port}`))) {
          this.protocol = 'https:'
          this.port = ''
          this.hostname = 'api.getfiddler.com'
        }
      }
    }
  }
})();
// Server
(async () => {
  const http = require('http')
  const path = require('path')
  const fs = require('fs')
  const { subtle } = require('crypto').webcrypto;

  // 准备密钥
  const key = await subtle.generateKey({
    name: 'ECDSA',
    hash: 'SHA-256',
    namedCurve: 'P-256',
    length: 256,
  }, true, ['sign', 'verify']);
  const pubKey = await subtle.exportKey('spki', key.publicKey)
  const priKey = await subtle.exportKey('pkcs8', key.privateKey)
  /**!SECTION
   * {
    key: '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCwMz2E8tIIXOXL\nnxxXnEmbZr47HJ79DIj7d9IEKY9hLbl8E6iXqPg0AOhGw3pNG4izt+z3zVOkZ0NV\nccl7//Evs9LU8MyU1tvzhpt/D98s7S/L/1BBsmLSX4xS3W651zOxiK5Oxt2aSJhI\nVKMzd5BsewgML7eduaT+b+nRzr/aXO2oaQA6w0ianhRBc21Zes03Fkz7Zz6Sigug\n7bqoTzEhSML9BbPOZqtilkdPNnVDuwt+6U88ip9X1oHuvirW/LXggVzBrxNC1n1Y\nbqm+U7sanojZ5mFzG4gFCxg71qpxGgLVRY+UtunvgEUcTyGk7dbxi/k61uxy9cM7\nxpdE8TLzAgMBAAECggEALhdhTt9UCOMAK6k1+UcFTDTuqzjb8Bbw2FMqKXOTsZiL\n7kSYM//72WKpYCVvXy9GLbj9sH7SE+39Q6Mt0RWNCmzwSEqrQX4I8GW0VGMa/r4W\n5Dan0F+xERX0d5K8DboZKCY4bpv/yQWXbEhTnrl2mqH+Y22yCvzOh85PrFX4gs6g\nLr/rvS67nyTyoSMd7o0jEM6Jv33aW0Oj4pWDAvw+zAiFJNIy23M1xn2YxQE8D4Sw\n5p6KMVI0/onY3JH9rZ2PkABOpuRvs+r1q3Tz8j2Ssvm4/4yCpjyikfhwWuoEr9ct\nCjMPYRKO9+yiMKz5rz1mOGLuQKYTmtc9w0NBWec4/QKBgQDXJN+/Ww8YJIpMgCUj\niNyePzhxojcx1zEPaYTgK5ezlvhmMtUzBbLOEfU3GsDNm9iMC5WHsyq9ZyedXRPs\nXTUpinJZcZILD90I0XSkcxBD+D39QJgGofYN4bAsmE4RQ7dfdLE4fcI6X2eGGah4\noKOayOtQ3UY3315RhM+pZMCsnQKBgQDRqSC7THPDyEf5RVpHQF3E6qCOlgW1yp3M\n+SgJTSyn+4eLO6xlynD2Wq5KM8mdCtNXoKvoc1XT/yua+0WUGUAexgL3pcBlKGZM\ngjf+PirOBwGrmmseqgDbe7g+1NvB6JWoZYNj7CMS50XN12kjqAqhIycHNbZVCbJ6\neu1VTDogzwKBgQCCsBGCacv3fGrOIaFtvntVXU3qKQGiMvfIRu7CRXi3TOPDIOnF\nPpbo+pucR5IK07ptB7RjZAB4YSr9OkcZ81yRyVnA3245bf90lddm9cZRo3/0UMKI\ndOXEdO3RiQsTDbFcOMRWbn4He2ClYvylmd8H7TiUPHWlBviCSEzktyEbOQKBgQCS\nwNCBac0qQFlouMutTfeUqyqBQ69xhQaZf9kvUY6tcll48ucERQR23BhdJgy8WOR/\n1J4f0gNEpbqu+6zDMj14jN9s2t9lrzaT3R42Xut1VOAtbqQGTbbV6q6XhETiYNvI\niG3ElngidjGdGGempqvyCHn8CPO8aFI+eyb+6qFRbwKBgFYvdEBp7OwrOvrj91jy\ncuEBYT5w57k6injPXxwP1tbBbUQxjyQW+cvmwmTP1aZ8ZgKtL0o0VJK4I5IhnGk1\nd4HdnIWVkrucajUOX+Onkj27M3RVZR403F7QfBUwVlCxBTkd7ZJgINEM37HJYz0F\ntGNmY8zJcOly/Q7MK+PCTmGG\n-----END PRIVATE KEY-----\n',
    cert: '-----BEGIN CERTIFICATE-----\nMIIDlzCCAn8CFGyRBww8wXXedLc+e5hZc/9qmLUhMA0GCSqGSIb3DQEBCwUAMIGH\nMQswCQYDVQQGEwJVUzELMAkGA1UECAwCU1MxDTALBgNVBAcMBGNpdHkxEDAOBgNV\nBAoMB2NvbXBhbnkxEDAOBgNVBAsMB3NlY3Rpb24xGTAXBgNVBAMMECouZ2V0Zmlk\nZGxlci5jb20xHTAbBgkqhkiG9w0BCQEWDmZha2VAZ21haWwuY29tMB4XDTI2MDcy\nNTExMjEzNFoXDTI2MDgyNDExMjEzNFowgYcxCzAJBgNVBAYTAlVTMQswCQYDVQQI\nDAJTUzENMAsGA1UEBwwEY2l0eTEQMA4GA1UECgwHY29tcGFueTEQMA4GA1UECwwH\nc2VjdGlvbjEZMBcGA1UEAwwQKi5nZXRmaWRkbGVyLmNvbTEdMBsGCSqGSIb3DQEJ\nARYOZmFrZUBnbWFpbC5jb20wggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIB\nAQCwMz2E8tIIXOXLnxxXnEmbZr47HJ79DIj7d9IEKY9hLbl8E6iXqPg0AOhGw3pN\nG4izt+z3zVOkZ0NVccl7//Evs9LU8MyU1tvzhpt/D98s7S/L/1BBsmLSX4xS3W65\n1zOxiK5Oxt2aSJhIVKMzd5BsewgML7eduaT+b+nRzr/aXO2oaQA6w0ianhRBc21Z\nes03Fkz7Zz6Sigug7bqoTzEhSML9BbPOZqtilkdPNnVDuwt+6U88ip9X1oHuvirW\n/LXggVzBrxNC1n1Ybqm+U7sanojZ5mFzG4gFCxg71qpxGgLVRY+UtunvgEUcTyGk\n7dbxi/k61uxy9cM7xpdE8TLzAgMBAAEwDQYJKoZIhvcNAQELBQADggEBAKpPQPtJ\nR1dm8MFGYka3HWOOPhHaKp+jyC33WcoYD/O9hcmN91GzBQPWmV5XSnA2yXITnxOm\nIEff+rd8zHSr2pbuMjbi1fQfo63iZ9rpFfLOXpjGPWkuqdXp+4coeOAfy4OdTS5N\nzuboQ1cmIFI0M5jHtEgFql8H2trmqExAOCpZRhA2ey6dD+TuyBv4HsWBXsQnqFcF\nTppnbDWLWpD7f1SURytsAmj9hXHch1Fm1QnM7+ZZP+QVrlbHf/xhBqwcKt/klq8S\nZ/xdpFYlYUJparcDCQZY2nTM6Rk1tJjUF6fIPwiki5IXjZsQlwmkCG2W80ZXcSP6\nIkjMll/23PumDd0=\n-----END CERTIFICATE-----\n',
  },
   */
  http.createServer( async (req, res) => {
    const fullPath = req.url
    const url = new URL(fullPath, `http://127.0.0.1:${port}`)
    let host = req.headers.host.split(':')[0]
    console.log(req.method, host, url.pathname)
    if (host.endsWith('.be')) {
      host = host.replace('.be', '.com')
    }
    if (host.includes('getfiddler.com')) {
      url.pathname = `/${host}${url.pathname}`
    }
    console.info('request header:', JSON.stringify(req.headers))
    // let body = '';
    // req.on('data', chunk => {
    //   body += chunk.toString();
    // });
    // req.on('end', () => {
    //   console.log(`Received data: ${body}`);
    // });
    
    let data = ''
    if (url != null) {
      try {
        const loc = path.resolve(__dirname, `./file/${url.pathname}`)
        if (fs.existsSync(loc + '.json'))
        {
          if (req.headers['x-request-nonce'])
            res.setHeader('x-response-nonce', req.headers['x-request-nonce'])
          // 在后面加上.json后缀，存在就用这个
          let body = fs.readFileSync(loc + '.json').toString()
          body = JSON.stringify(JSON.parse(body))
          const headers = {
            'content-type': 'application/json; charset=utf-8',
            'x-signature-timestamp': `${Math.floor(Date.now() / 1000)}`,
            'x-date': new Date().toGMTString()
          }
          for (const k in headers) {
            res.setHeader(k, headers[k])
          }
          data = body
          const signData = Object.keys(headers).map(k => `${k}:${headers[k]}`).join('\n') + body
          // console.log('原始数据：', signData)
          const signPriKey = await subtle.importKey('pkcs8', priKey, { name: "ECDSA", namedCurve: "P-256" }, true, ['sign'])
          // console.log('signPriKey ok')
          const bodyBuf = Buffer.from(signData, 'binary')
          // console.log('signData length:', bodyBuf.length)
          const signature = await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signPriKey, bodyBuf)
          // console.log('signature ok')
      
          // 生成签名头数据
          const pubLen = Buffer.from(new Uint8Array(4))
          pubLen.writeInt32BE(pubKey.byteLength)
          // console.log('len:', pubKey.byteLength, len)
          const signatureHeader = Buffer.concat([new Uint8Array(pubLen), new Uint8Array(pubKey), new Uint8Array(signature)])
          // console.log('signatureHeader length:', signatureHeader.length)
          const signedHeaders = Object.keys(headers).join(';')
          res.setHeader('Signature', `SignedHeaders=${signedHeaders}, Signature=${signatureHeader.toString('base64')}`)
          
        }
        else if (fs.existsSync(loc)) { // 直接使用原始路径
          if (loc.endsWith('.json')) {
            res.setHeader('content-type', 'application/json; charset=utf-8')
          }
          data = fs.readFileSync(loc).toString()
        }
        else {
          data = 'not implement'
          console.log(`error: ${fullPath}`)
        }

      }catch(e) {
        console.error(e)
      }
    }
    
    res.end(data)
  }).listen(port)
})();

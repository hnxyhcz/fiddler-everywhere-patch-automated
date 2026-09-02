const port = 5678;
(() => {
  console.info('========== Fiddler-everywhere-enhance start ==========')
  const { app, BrowserWindow } = require('electron')
  const path = require('path')
  const fs = require('fs')
  const sp = require('child_process')
  const debug = process.env.FE_PATCH_DEBUG === '1'
  const debugLog = (...args) => {
    if (debug) console.info(...args)
  }

  const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf-8'))
  let mainXJsPathCache = null
  const getMainXJsPath = () => {
    if (mainXJsPathCache) {
      return mainXJsPathCache
    }
    const index = fs.readFileSync(path.resolve(__dirname, './WebServer/ClientApp/dist/index.html')).toString()
    const match = index.match(/main.*?\.js/)
    if (!match) {
      throw new Error('Cannot find Web UI main JavaScript file in index.html')
    }
    mainXJsPathCache = path.resolve(__dirname, `./WebServer/ClientApp/dist/${match[0]}`)
    return mainXJsPathCache
  }

  const writeIfChanged = (filePath, original, updated, label) => {
    if (updated === original) {
      debugLog(`${label}: no change needed`)
      return false
    }
    fs.writeFileSync(filePath, updated)
    debugLog(`${label}: updated`)
    return true
  }

  const mainXHandle = {
    replace: () => {
      // 修改mian-xxx.js文件
      debugLog('Modify main-XXXXXXX.js (Or main.XXXXXXXXXXXXX.js in old versions)')
      const mainXJsPath = getMainXJsPath()
      let mainXJs = fs.readFileSync(mainXJsPath).toString()
      // FE 8.1.0 may spell these endpoints with either ".com" or ".be".
      // Always use a local URL with the original host in the path; this does
      // not require a system hosts-file modification.
      const updated = mainXJs
        .replace(/https:\/\/api\.getfiddler\.(?:com|be)/g, `http://127.0.0.1:${port}/api.getfiddler.com`)
        .replace(/https:\/\/identity\.getfiddler\.(?:com|be)/g, `http://127.0.0.1:${port}/identity.getfiddler.com`)
      // "https://","api",".get","fiddler",".com"
        .replace(new RegExp(`"https://","api",".get","fiddler","\\.(?:com|be)"`, 'g'), `"http://127.0.0.1:${port}/","api",".get","fiddler",".com"`)
        .replace(new RegExp(`"https://","identity",".get","fiddler","\\.(?:com|be)"`, 'g'), `"http://127.0.0.1:${port}/","identity",".get","fiddler",".com"`)

      writeIfChanged(mainXJsPath, mainXJs, updated, 'Web UI endpoint patch')
    },
    reset: () => {
      // 还原mian-xxx.js文件
      debugLog('Recover main-XXXXXXX.js (Or main.XXXXXXXXXXXXX.js in old versions)')
      const mainXJsPath = getMainXJsPath()
      let mainXJs = fs.readFileSync(mainXJsPath).toString()
      const updated = mainXJs
        .replace(new RegExp(`http://127\\.0\\.0\\.1:\\d+/`, 'g'), 'https://')
        .replace(new RegExp(`"http://","api"`, 'g'), '"https://","api"')
        .replace(new RegExp(`"http://","identity"`, 'g'), '"https://","identity"')
        .replace(new RegExp(`",".get","fiddler","\\.be(?::\\d+)?"`, 'g'), `",".get","fiddler",".com"`)
      writeIfChanged(mainXJsPath, mainXJs, updated, 'Web UI endpoint reset')
    }
  }
  const originalSpwan = sp.spawn
  sp.spawn = function(...args) {
    debugLog('Call spwan:', args[0])
    if (args[0].includes('Fiddler.WebUi'))
    {
      // Keep the on-disk Web UI file original while the backend starts. The
      // local endpoint rewrite is applied only when Electron loads index.html.
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
        debugLog('HookedBrowserWindow:', options)
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
    debugLog('Call loadURL', args)
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
    const U = global.URL
    global.URL = class extends U {
      constructor(u, base) {
        super(u, base)
        debugLog('new URL -> ', u)
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
    debugLog(req.method, host, url.pathname)
    if (host.endsWith('.be')) {
      host = host.replace('.be', '.com')
    }
    if (host.includes('getfiddler.com')) {
      url.pathname = `/${host}${url.pathname}`
    }
    debugLog('request header:', JSON.stringify(req.headers))
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
          const signPriKey = key.privateKey
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

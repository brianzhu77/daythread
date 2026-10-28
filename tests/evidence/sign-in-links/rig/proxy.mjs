// Stands in for Supabase's gateway: strips /auth/v1 and forwards to the local auth server on 9999. Rig only.
import http from 'node:http'
http.createServer((req, res) => {
  const path = req.url.replace(/^\/auth\/v1/, '') || '/'
  const up = http.request({ host: '127.0.0.1', port: 9999, path, method: req.method, headers: { ...req.headers, host: '127.0.0.1:9999' } }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res) })
  up.on('error', e => { res.writeHead(502); res.end(String(e)) })
  req.pipe(up)
}).listen(54321, '127.0.0.1', () => console.log('proxy on 54321'))

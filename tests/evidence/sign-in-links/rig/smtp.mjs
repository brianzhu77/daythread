// Minimal SMTP sink (no TLS, accepts any AUTH): each message is saved to /tmp/rb-gotrue/mail/<n>.eml. Rig only.
import net from 'node:net'; import fs from 'node:fs'
let n = fs.readdirSync('/tmp/rb-gotrue/mail').length
net.createServer(s => {
  let data = false, buf = '', msg = ''
  const say = l => s.write(l + '\r\n')
  say('220 sink')
  s.on('data', d => {
    buf += d.toString('utf8')
    let i
    while ((i = buf.indexOf('\r\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 2)
      if (data) {
        if (line === '.') { data = false; fs.writeFileSync(`/tmp/rb-gotrue/mail/${String(++n).padStart(3, '0')}.eml`, msg); msg = ''; say('250 ok') }
        else msg += (line.startsWith('..') ? line.slice(1) : line) + '\n'
        continue
      }
      const cmd = line.slice(0, 4).toUpperCase()
      if (cmd === 'EHLO') { s.write('250-sink\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n') }
      else if (cmd === 'HELO') say('250 sink')
      else if (cmd === 'AUTH') say('235 ok')
      else if (cmd === 'DATA') { data = true; say('354 go') }
      else if (cmd === 'QUIT') { say('221 bye'); s.end() }
      else say('250 ok')
    }
  })
}).listen(2525, '127.0.0.1', () => console.log('smtp sink on 2525'))

// The account menu inside the apps (2D and 3D). The Worker in front of each app adds
// this script and window.__oaUser = { name, email, picture } to the app's HTML, so the
// apps themselves carry no sign-in code. Everything sits in a shadow root: the app's
// styles cannot reach it and it cannot reach theirs.
(() => {
  const user = window.__oaUser
  if (!user || document.getElementById('oa-account')) return
  const me = document.currentScript && document.currentScript.src
  const site = me ? new URL(me).origin : location.origin       // openanstruk.org, where the account lives

  const host = document.createElement('div')
  host.id = 'oa-account'
  const root = host.attachShadow({ mode: 'open' })
  const initial = (user.name || user.email || '?').trim().charAt(0).toUpperCase()
  // Where the button sits, chosen per app by its Worker (user.place) so it covers nothing:
  // the 2D app has room at the right end of its top bar; the 3D app at the foot of the
  // canvas, left, under the tool rail.
  const PLACES = {
    'top-right': { host: 'top: 4px; right: 14px;', menu: 'right: 0; top: 46px;' },
    'canvas-bottom-left': { host: 'left: 22px; bottom: 58px;', menu: 'left: 0; bottom: 46px;' },
    'bottom-right': { host: 'right: 14px; bottom: 14px;', menu: 'right: 0; bottom: 46px;' },
  }
  const PLACE = PLACES[user.place] || PLACES['bottom-right']
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

  root.innerHTML = `
<style>
  :host { all: initial; position: fixed; z-index: 2147483000; font: 400 14px/1.4 'DM Sans', system-ui, sans-serif; ${PLACE.host} }
  button.av { width: 36px; height: 36px; padding: 0; border-radius: 50%; border: 2px solid #fff; background: #0b2550; color: #fff;
    font: 600 15px 'DM Sans', system-ui, sans-serif; cursor: pointer; overflow: hidden; box-shadow: 0 6px 16px -6px rgba(11,37,80,.6); opacity: .9; }
  button.av:hover, button.av[aria-expanded="true"] { opacity: 1; }
  button.av img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .menu { position: absolute; ${PLACE.menu} min-width: 230px; max-width: calc(100vw - 28px); background: #fff; color: #0b2550;
    border: 1px solid #d9e1ec; border-radius: 12px; box-shadow: 0 18px 40px -18px rgba(11,37,80,.45); padding: 6px; }
  .menu[hidden] { display: none; }
  .id { padding: 10px 10px 8px; border-bottom: 1px solid #e6ecf4; margin-bottom: 4px; }
  .id b { display: block; font-weight: 600; }
  .id span { display: block; font: 400 12px 'DM Mono', ui-monospace, monospace; color: #5b6b7e; word-break: break-all; }
  a { display: block; padding: 9px 10px; border-radius: 8px; color: #0b2550; text-decoration: none; }
  a:hover, a:focus-visible { background: #f0f4fa; outline: none; }
  a.bad { color: #a3242c; }
</style>
<div class="menu" role="menu" hidden>
  <div class="id"><b>${esc(user.name || 'Akun')}</b><span>${esc(user.email || '')}</span></div>
  <a role="menuitem" href="${site}/profil">Edit profil</a>
  <a role="menuitem" href="${site}/profil#hapus" class="bad">Hapus akun</a>
  <a role="menuitem" href="${site}/logout">Keluar</a>
</div>
<button class="av" type="button" aria-haspopup="menu" aria-expanded="false" title="Akun: ${esc(user.email || '')}">${esc(initial)}</button>`

  const btn = root.querySelector('button.av'), menu = root.querySelector('.menu')
  if (user.picture) {
    const img = new Image()
    img.alt = ''; img.referrerPolicy = 'no-referrer'
    img.onload = () => { btn.textContent = ''; btn.appendChild(img) }
    img.src = user.picture
  }
  const set = open => { menu.hidden = !open; btn.setAttribute('aria-expanded', String(open)) }
  btn.addEventListener('click', e => { e.stopPropagation(); set(menu.hidden) })
  document.addEventListener('click', e => { if (!e.composedPath().includes(host)) set(false) })
  document.addEventListener('keydown', e => { if (e.key === 'Escape') set(false) })

  document.body.appendChild(host)
})()

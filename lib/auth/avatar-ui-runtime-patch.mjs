const PROFILE_SUMMARY = '<summary aria-label="Account menu">Account</summary>';
const PROFILE_SUMMARY_PATCHED = '<summary aria-label="Account menu"><span class="asProfileAvatarShell"><img id="asProfileAvatarImg" alt="" hidden><span class="asProfileAvatarFallback" id="asProfileAvatarFallback" aria-hidden="true"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="4"/><path d="M4.5 21c.7-4.5 3.2-7 7.5-7s6.8 2.5 7.5 7" stroke-linecap="round"/></svg></span><span class="asProfileCameraBadge" aria-hidden="true">+</span></span></summary>';
const PROFILE_HEADING = '<strong>Auto Scout account</strong>';
const PROFILE_HEADING_PATCHED = '<div class="asProfileHead"><span class="asProfileMenuAvatar"><img id="asProfileMenuImg" alt="" hidden><span class="asProfileMenuFallback" id="asProfileMenuFallback" aria-hidden="true">U</span></span><span><strong>Oblige Props</strong><small id="asProfileEmail">Account</small></span></div><button class="asBtn asAvatarEdit" id="asAvatarEdit" type="button">Change profile photo</button>';
const LOAD_ACCOUNT_ANCHOR = "if(button){button.textContent=account.authenticated?'Account':'Sign in';button.classList.toggle('asPrimary',!account.authenticated);}";
const LOAD_ACCOUNT_PATCHED = `${LOAD_ACCOUNT_ANCHOR}if(window.__syncProfileAvatar)window.__syncProfileAvatar();`;
const ACCOUNT_SCOPE_ANCHOR = 'var account={authenticated:false,user:null,csrfToken:null},accountHealth=null,entitlement=null,accuracy=null,authBusy=false;';
const MARKER = '__OBLIGE_PROFILE_AVATAR_V1__';

function avatarClientRuntime() {
  var PROFILE_RUNTIME_MARKER = '__OBLIGE_PROFILE_AVATAR_V1__';
  if (window[PROFILE_RUNTIME_MARKER]) return;
  window[PROFILE_RUNTIME_MARKER] = true;

  var style = document.createElement('style');
  style.id = 'oblige-profile-avatar-style';
  style.textContent = `
#as5 .asProfileMenu{position:relative!important;margin:0!important;z-index:60!important}
#as5 .asProfileMenu>summary{list-style:none!important;width:48px!important;height:48px!important;min-width:48px!important;padding:2px!important;border-radius:50%!important;border:1px solid rgba(89,127,177,.55)!important;background:linear-gradient(180deg,rgba(15,31,52,.98),rgba(8,19,35,.98))!important;display:grid!important;place-items:center!important;cursor:pointer!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 9px 24px rgba(0,0,0,.25)!important;overflow:visible!important;font-size:0!important;transition:border-color .16s ease,box-shadow .16s ease,transform .16s ease!important}
#as5 .asProfileMenu>summary::-webkit-details-marker{display:none!important}
#as5 .asProfileMenu>summary::marker{display:none!important;content:""!important}
#as5 .asProfileMenu>summary:hover,#as5 .asProfileMenu>summary:focus-visible,#as5 .asProfileMenu[open]>summary{border-color:#5f9cff!important;box-shadow:0 0 0 3px rgba(55,132,255,.13),0 10px 26px rgba(0,0,0,.3)!important;outline:none!important}
#as5 .asProfileMenu>summary:active{transform:scale(.97)!important}
#as5 .asProfileAvatarShell{position:relative!important;width:42px!important;height:42px!important;border-radius:50%!important;display:grid!important;place-items:center!important;overflow:visible!important}
#as5 .asProfileAvatarShell img,#as5 .asProfileMenuAvatar img{width:100%!important;height:100%!important;border-radius:50%!important;object-fit:cover!important;display:block!important;background:#0b1423!important}
#as5 .asProfileAvatarFallback{width:100%!important;height:100%!important;border-radius:50%!important;display:grid!important;place-items:center!important;color:#d9e8fb!important;background:radial-gradient(circle at 50% 28%,rgba(95,156,255,.16),rgba(9,22,39,.95) 72%)!important;font-size:15px!important;font-weight:900!important;line-height:1!important}
#as5 .asProfileAvatarFallback svg{width:25px!important;height:25px!important}
#as5 .asProfileCameraBadge{position:absolute!important;right:-2px!important;bottom:-2px!important;width:17px!important;height:17px!important;border-radius:50%!important;display:grid!important;place-items:center!important;background:#2f7dff!important;color:white!important;border:2px solid #07101d!important;font-size:13px!important;font-weight:900!important;line-height:1!important;box-shadow:0 2px 8px rgba(0,0,0,.4)!important}
#as5 .asProfileDropdown{right:0!important;left:auto!important;width:270px!important;padding:12px!important;border-radius:18px!important;border:1px solid rgba(74,111,158,.45)!important;background:linear-gradient(180deg,rgba(10,25,44,.985),rgba(5,14,28,.99))!important;box-shadow:0 24px 58px rgba(0,0,0,.48),inset 0 1px 0 rgba(255,255,255,.04)!important;backdrop-filter:blur(24px)!important;-webkit-backdrop-filter:blur(24px)!important}
#as5 .asProfileHead{display:grid!important;grid-template-columns:46px minmax(0,1fr)!important;gap:10px!important;align-items:center!important;padding:2px 2px 10px!important;margin-bottom:8px!important;border-bottom:1px solid rgba(75,107,148,.28)!important}
#as5 .asProfileHead>span:last-child{min-width:0!important}
#as5 .asProfileHead strong{display:block!important;color:#f4f8ff!important;font-size:13px!important;line-height:1.15!important}
#as5 .asProfileHead small{display:block!important;margin-top:4px!important;color:#8298b4!important;font-size:10px!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important}
#as5 .asProfileMenuAvatar{width:46px!important;height:46px!important;border-radius:50%!important;display:grid!important;place-items:center!important;border:1px solid rgba(91,144,206,.5)!important;background:#0a1728!important;overflow:hidden!important}
#as5 .asProfileMenuFallback{width:100%!important;height:100%!important;display:grid!important;place-items:center!important;font-size:16px!important;font-weight:900!important;color:#d7e7fa!important;background:radial-gradient(circle at 50% 28%,rgba(95,156,255,.18),rgba(8,21,38,.96) 72%)!important}
#as5 .asProfileDropdown .asBtn{width:100%!important;justify-content:flex-start!important;text-align:left!important;margin-top:5px!important}
#as5 .asProfileDropdown .asAvatarEdit{border-color:rgba(55,132,255,.52)!important;background:rgba(33,104,219,.14)!important;color:#cfe2ff!important}
#as5 .asAvatarEditor{display:grid!important;gap:14px!important}
#as5 .asAvatarPreviewWrap{width:128px!important;height:128px!important;margin:2px auto 4px!important;border-radius:50%!important;border:1px solid rgba(88,143,210,.6)!important;background:radial-gradient(circle at 50% 25%,rgba(89,151,255,.18),#091426 72%)!important;display:grid!important;place-items:center!important;overflow:hidden!important;box-shadow:0 14px 34px rgba(0,0,0,.28)!important}
#as5 .asAvatarPreviewWrap img{width:100%!important;height:100%!important;object-fit:cover!important}
#as5 .asAvatarPreviewFallback{font-size:30px!important;font-weight:900!important;color:#cfe0f5!important}
#as5 .asAvatarEditor p{margin:0!important;color:#8ea4bf!important;font-size:11px!important;line-height:1.45!important;text-align:center!important}
#as5 .asAvatarActions{display:grid!important;grid-template-columns:1fr 1fr!important;gap:8px!important}
#as5 .asAvatarActions .asBtn{height:40px!important}
#as5 .asAvatarChoose{display:grid!important;place-items:center!important;cursor:pointer!important}
#as5 .asAvatarDanger{border-color:rgba(255,104,120,.38)!important;color:#ffadb7!important;background:rgba(142,34,49,.13)!important}
#as5 .asAvatarSave{grid-column:1/-1!important;background:linear-gradient(145deg,#1686ff,#1763f0)!important;border-color:#2f91ff!important;color:white!important}
#as5 .asAvatarSave:disabled{opacity:.45!important;cursor:not-allowed!important}
@media(max-width:700px){
 #as5 .asProfileMenu>summary{width:42px!important;height:42px!important;min-width:42px!important;padding:2px!important}
 #as5 .asProfileAvatarShell{width:36px!important;height:36px!important}
 #as5 .asProfileCameraBadge{width:15px!important;height:15px!important;font-size:11px!important}
 #as5 .asProfileDropdown{position:fixed!important;top:62px!important;right:10px!important;width:min(290px,calc(100vw - 20px))!important}
}
`;
  (document.head || document.documentElement).appendChild(style);

  function initial() {
    var email = account && account.authenticated && account.user && account.user.email ? account.user.email : '';
    return email ? email.charAt(0).toUpperCase() : '';
  }

  function setFallback(fallback, signedIn) {
    if (!fallback) return;
    var value = signedIn ? initial() : '';
    if (value) fallback.textContent = value;
    else fallback.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="4"/><path d="M4.5 21c.7-4.5 3.2-7 7.5-7s6.8 2.5 7.5 7" stroke-linecap="round"/></svg>';
    fallback.hidden = false;
  }

  function sync(forceStamp) {
    var signedIn = !!(account && account.authenticated);
    var emailEl = document.getElementById('asProfileEmail');
    if (emailEl) emailEl.textContent = signedIn && account.user && account.user.email ? account.user.email : 'Sign in to personalize';
    var edit = document.getElementById('asAvatarEdit');
    if (edit && edit.onclick !== openEditor) edit.onclick = openEditor;
    var pairs = [
      [document.getElementById('asProfileAvatarImg'), document.getElementById('asProfileAvatarFallback')],
      [document.getElementById('asProfileMenuImg'), document.getElementById('asProfileMenuFallback')],
    ];
    pairs.forEach(function(pair) {
      var img = pair[0], fallback = pair[1];
      if (!img) return;
      img.hidden = true;
      setFallback(fallback, signedIn);
      if (!signedIn) {
        img.removeAttribute('src');
        return;
      }
      img.onload = function() { img.hidden = false; if (fallback) fallback.hidden = true; };
      img.onerror = function() { img.hidden = true; setFallback(fallback, true); };
      img.src = '/api/account/avatar?v=' + encodeURIComponent(String(forceStamp || Date.now()));
    });
  }
  window.__syncProfileAvatar = sync;

  function processedAvatar(file) {
    return new Promise(function(resolve, reject) {
      if (!file || !/^image\//i.test(file.type || '')) return reject(new Error('Choose an image file.'));
      if (file.size > 10 * 1024 * 1024) return reject(new Error('Choose an image smaller than 10 MB.'));
      var objectUrl = URL.createObjectURL(file);
      var image = new Image();
      image.onload = function() {
        try {
          var width = Number(image.naturalWidth || image.width || 0);
          var height = Number(image.naturalHeight || image.height || 0);
          if (width < 32 || height < 32) throw new Error('That image is too small.');
          var crop = Math.min(width, height);
          var sx = Math.max(0, (width - crop) / 2);
          var sy = Math.max(0, (height - crop) / 2);
          function encode(size, type, quality) {
            var canvas = document.createElement('canvas');
            canvas.width = canvas.height = size;
            var ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('Image processing is unavailable in this browser.');
            ctx.drawImage(image, sx, sy, crop, crop, 0, 0, size, size);
            return canvas.toDataURL(type, quality);
          }
          var dataUrl = encode(384, 'image/webp', .86);
          if (!/^data:image\/webp;base64,/.test(dataUrl)) dataUrl = encode(384, 'image/jpeg', .86);
          if (dataUrl.length > 690000) dataUrl = encode(320, 'image/jpeg', .78);
          if (dataUrl.length > 690000) throw new Error('That image is still too large after resizing. Try another photo.');
          resolve(dataUrl);
        } catch (error) {
          reject(error);
        } finally {
          URL.revokeObjectURL(objectUrl);
        }
      };
      image.onerror = function() { URL.revokeObjectURL(objectUrl); reject(new Error('That photo could not be opened. Try JPEG, PNG, or WebP.')); };
      image.src = objectUrl;
    });
  }

  function openEditor() {
    if (!(account && account.authenticated)) {
      accountPanel();
      return;
    }
    utility('Profile photo',
      '<div class="asAvatarEditor">'
      + '<div class="asAvatarPreviewWrap"><img id="asAvatarPreview" alt="Profile photo preview"><span class="asAvatarPreviewFallback" id="asAvatarPreviewFallback">' + initial() + '</span></div>'
      + '<p>Choose a photo from this device. Oblige Props crops it to a square and stores only the resized profile image for this account.</p>'
      + '<input id="asAvatarFile" type="file" accept="image/jpeg,image/png,image/webp,image/*" hidden>'
      + '<div class="asAvatarActions"><label class="asBtn asAvatarChoose" for="asAvatarFile">Choose photo</label><button class="asBtn asAvatarDanger" id="asAvatarRemove" type="button">Remove photo</button><button class="asBtn asAvatarSave" id="asAvatarSave" type="button" disabled>Save photo</button></div>'
      + '</div>');

    var preview = document.getElementById('asAvatarPreview');
    var previewFallback = document.getElementById('asAvatarPreviewFallback');
    if (preview) {
      preview.onload = function() { preview.hidden = false; if (previewFallback) previewFallback.hidden = true; };
      preview.onerror = function() { preview.hidden = true; if (previewFallback) previewFallback.hidden = false; };
      preview.src = '/api/account/avatar?edit=' + Date.now();
    }

    var prepared = null;
    var fileInput = document.getElementById('asAvatarFile');
    var save = document.getElementById('asAvatarSave');
    if (fileInput) fileInput.onchange = async function() {
      prepared = null;
      if (save) save.disabled = true;
      var file = fileInput.files && fileInput.files[0];
      if (!file) return;
      try {
        prepared = await processedAvatar(file);
        if (preview) { preview.hidden = false; preview.src = prepared; }
        if (previewFallback) previewFallback.hidden = true;
        if (save) save.disabled = false;
      } catch (error) {
        toast(String(error && error.message || 'That photo could not be prepared.'));
      }
    };

    if (save) save.onclick = async function() {
      if (!prepared) return;
      save.disabled = true;
      var result = await accountPost('/api/account/avatar', { image: prepared });
      if (result.status === 200 && result.data && result.data.ok) {
        sync(Date.now());
        toast('Profile photo updated.');
        var dialog = document.getElementById('asUtility');
        if (dialog && dialog.open) dialog.close();
      } else {
        save.disabled = false;
        toast(result.data && result.data.message ? result.data.message : 'Profile photo could not be saved.');
      }
    };

    var remove = document.getElementById('asAvatarRemove');
    if (remove) remove.onclick = async function() {
      remove.disabled = true;
      var result = await accountPost('/api/account/avatar', { remove: true });
      if (result.status === 200 && result.data && result.data.ok) {
        sync(Date.now());
        toast('Profile photo removed.');
        var dialog = document.getElementById('asUtility');
        if (dialog && dialog.open) dialog.close();
      } else {
        remove.disabled = false;
        toast(result.data && result.data.message ? result.data.message : 'Profile photo could not be removed.');
      }
    };
  }

  function init() {
    var edit = document.getElementById('asAvatarEdit');
    if (edit) edit.onclick = openEditor;
    sync();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
}

export function patchProfileAvatarUi(source) {
  const input = String(source || '');
  if (input.includes(MARKER)) return input;
  if (!input.includes(PROFILE_SUMMARY)) throw new Error('Profile avatar patch could not locate the account summary.');
  if (!input.includes(PROFILE_HEADING)) throw new Error('Profile avatar patch could not locate the account dropdown heading.');
  if (!input.includes(LOAD_ACCOUNT_ANCHOR)) throw new Error('Profile avatar patch could not locate account refresh wiring.');
  if (!input.includes(ACCOUNT_SCOPE_ANCHOR)) throw new Error('Profile avatar patch could not locate the account scope.');

  let patched = input
    .replace(PROFILE_SUMMARY, PROFILE_SUMMARY_PATCHED)
    .replace(PROFILE_HEADING, PROFILE_HEADING_PATCHED)
    .replace(LOAD_ACCOUNT_ANCHOR, LOAD_ACCOUNT_PATCHED);

  const runtime = `\n;(${avatarClientRuntime.toString()})();\n`;
  patched = patched.replace(ACCOUNT_SCOPE_ANCHOR, `${ACCOUNT_SCOPE_ANCHOR}${runtime}`);
  return patched;
}

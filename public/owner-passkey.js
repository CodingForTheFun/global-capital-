;(function ownerPasskeyClient(){
  'use strict';
  if(window.ObligeOwnerSecurity)return;
  var nativeFetch=window.fetch.bind(window);
  var meCache=null,meCacheAt=0,panelBusy=false;

  function b64ToBuffer(value){
    var text=String(value||'').replace(/-/g,'+').replace(/_/g,'/');
    while(text.length%4)text+='=';
    var binary=atob(text),bytes=new Uint8Array(binary.length);
    for(var i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
    return bytes.buffer;
  }
  function bufferToB64(value){
    if(value==null)return null;
    var bytes=new Uint8Array(value),binary='';
    for(var i=0;i<bytes.length;i++)binary+=String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  }
  async function readJson(response){return response.json().catch(function(){return null;});}
  function errorFrom(data,fallback){var e=new Error(data&&data.message||fallback||'That security check did not complete.');e.code=data&&data.code;return e;}
  function credentialBody(credential){
    var response=credential.response;
    return {
      credentialId:credential.id,
      rawId:bufferToB64(credential.rawId),
      clientDataJSON:bufferToB64(response.clientDataJSON),
      authenticatorData:bufferToB64(response.authenticatorData),
      signature:bufferToB64(response.signature),
      userHandle:bufferToB64(response.userHandle),
    };
  }
  function registrationBody(credential){
    var response=credential.response;
    var publicKey=typeof response.getPublicKey==='function'?response.getPublicKey():null;
    var authenticatorData=typeof response.getAuthenticatorData==='function'?response.getAuthenticatorData():null;
    var algorithm=typeof response.getPublicKeyAlgorithm==='function'?response.getPublicKeyAlgorithm():null;
    if(!publicKey||!authenticatorData||!Number.isFinite(Number(algorithm)))throw new Error('This browser cannot securely enroll a passkey here yet. Update the browser and try again.');
    return {
      credentialId:credential.id,
      rawId:bufferToB64(credential.rawId),
      clientDataJSON:bufferToB64(response.clientDataJSON),
      authenticatorData:bufferToB64(authenticatorData),
      publicKey:bufferToB64(publicKey),
      publicKeyAlgorithm:Number(algorithm),
      transports:typeof response.getTransports==='function'?response.getTransports():[],
    };
  }
  function loginOptions(publicKey){return {
    challenge:b64ToBuffer(publicKey.challenge),
    rpId:publicKey.rpId,
    timeout:publicKey.timeout,
    userVerification:publicKey.userVerification||'required',
    allowCredentials:(publicKey.allowCredentials||[]).map(function(row){return{type:'public-key',id:b64ToBuffer(row.id),transports:row.transports};}),
  };}
  function registerOptions(publicKey){return {
    challenge:b64ToBuffer(publicKey.challenge),
    rp:publicKey.rp,
    user:{id:b64ToBuffer(publicKey.user.id),name:publicKey.user.name,displayName:publicKey.user.displayName},
    pubKeyCredParams:publicKey.pubKeyCredParams,
    authenticatorSelection:publicKey.authenticatorSelection,
    timeout:publicKey.timeout,
    attestation:publicKey.attestation||'none',
    excludeCredentials:(publicKey.excludeCredentials||[]).map(function(row){return{type:'public-key',id:b64ToBuffer(row.id),transports:row.transports};}),
  };}
  async function passkeyLogin(remember){
    if(!window.PublicKeyCredential||!navigator.credentials)throw new Error('Passkeys are not available in this browser.');
    var start=await nativeFetch('/api/account/passkey/login/options',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({rememberMe:remember===true})});
    var startData=await readJson(start);if(!start.ok||!startData||!startData.publicKey)throw errorFrom(startData,'Passkey sign-in could not start.');
    var credential=await navigator.credentials.get({publicKey:loginOptions(startData.publicKey)});
    if(!credential)throw new Error('Passkey sign-in was cancelled.');
    var finish=await nativeFetch('/api/account/passkey/login/verify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(credentialBody(credential))});
    var data=await readJson(finish);if(!finish.ok||!data||!data.ok)throw errorFrom(data,'Passkey sign-in failed.');
    meCache=null;meCacheAt=0;return data;
  }
  async function accountMe(force){
    if(!force&&meCache&&Date.now()-meCacheAt<5000)return meCache;
    var response=await nativeFetch('/api/account/me',{headers:{accept:'application/json'}}),data=await readJson(response);
    meCache=response.ok&&data?data:null;meCacheAt=Date.now();return meCache;
  }
  async function registerPasskey(){
    if(!window.PublicKeyCredential||!navigator.credentials)throw new Error('Passkeys are not available in this browser.');
    var me=await accountMe(true);
    if(!me||!me.authenticated||me.user&&me.user.role!=='owner')throw new Error('Sign in to the owner account before adding a passkey.');
    var start=await nativeFetch('/api/account/passkey/register/options',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':me.csrfToken||''},body:'{}'});
    var startData=await readJson(start);if(!start.ok||!startData||!startData.publicKey)throw errorFrom(startData,'Passkey enrollment could not start.');
    var credential=await navigator.credentials.create({publicKey:registerOptions(startData.publicKey)});
    if(!credential)throw new Error('Passkey enrollment was cancelled.');
    var finish=await nativeFetch('/api/account/passkey/register/verify',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':me.csrfToken||''},body:JSON.stringify(registrationBody(credential))});
    var data=await readJson(finish);if(!finish.ok||!data||!data.ok)throw errorFrom(data,'Passkey enrollment failed.');
    meCache=null;meCacheAt=0;
    if(Array.isArray(data.recoveryCodes)&&data.recoveryCodes.length)showRecoveryCodes(data.recoveryCodes);
    else notify('Passkey added. Password-only owner access is now blocked.');
    return data;
  }
  async function recoveryLogin(email,password,recoveryCode,remember){
    var response=await nativeFetch('/api/account/passkey/recovery',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:email,password:password,recoveryCode:recoveryCode,rememberMe:remember===true})});
    var data=await readJson(response);if(!response.ok||!data||!data.ok)throw errorFrom(data,'Owner recovery failed.');
    meCache=null;meCacheAt=0;return data;
  }
  function notify(message){
    var toast=document.getElementById('asToast');
    if(toast){toast.textContent=message;toast.classList.add('on');setTimeout(function(){toast.classList.remove('on');},4500);return;}
    alert(message);
  }
  function securityDialog(title,html){
    var dialog=document.getElementById('ownerSecurityDialog');
    if(!dialog){dialog=document.createElement('dialog');dialog.id='ownerSecurityDialog';dialog.style.cssText='max-width:520px;width:calc(100% - 28px);border:1px solid #33445f;border-radius:16px;background:#0d1727;color:#eef5ff;padding:22px;box-shadow:0 24px 80px #0009;';document.body.appendChild(dialog);}
    dialog.innerHTML='<h2 style="margin:0 0 10px">'+title+'</h2>'+html+'<button type="button" id="ownerSecurityClose" style="margin-top:16px;height:40px;border:1px solid #3a4d69;border-radius:9px;background:#142238;color:#fff;padding:0 14px">Close</button>';
    document.getElementById('ownerSecurityClose').onclick=function(){dialog.close();};
    if(!dialog.open)dialog.showModal();return dialog;
  }
  function showRecoveryCodes(codes){
    var escaped=codes.map(function(code){return String(code).replace(/[&<>]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;'}[c];});});
    var dialog=securityDialog('Save your owner recovery codes','<p style="color:#aebed4">These codes are shown once. Store them somewhere offline. Each code works one time together with your owner password if you lose your passkey.</p><pre id="ownerRecoveryCodes" style="white-space:pre-wrap;background:#08111e;border:1px solid #263a58;border-radius:10px;padding:14px;line-height:1.7">'+escaped.join('\n')+'</pre><button type="button" id="ownerCopyRecovery" style="height:40px;border:0;border-radius:9px;background:#3273ee;color:#fff;padding:0 14px;font-weight:700">Copy codes</button>');
    document.getElementById('ownerCopyRecovery').onclick=async function(){try{await navigator.clipboard.writeText(codes.join('\n'));this.textContent='Copied';}catch{this.textContent='Copy unavailable';}};
    return dialog;
  }
  function showRecoveryForm(){
    var dialog=securityDialog('Owner recovery','<p style="color:#aebed4">Use your owner password plus one unused recovery code. The password alone cannot unlock owner access after passkey setup.</p><label style="display:block;margin:10px 0 5px">Email</label><input id="ownerRecoveryEmail" type="email" autocomplete="email" style="width:100%;height:44px;background:#091321;border:1px solid #33445f;border-radius:9px;color:#fff;padding:0 10px"><label style="display:block;margin:10px 0 5px">Password</label><input id="ownerRecoveryPassword" type="password" autocomplete="current-password" style="width:100%;height:44px;background:#091321;border:1px solid #33445f;border-radius:9px;color:#fff;padding:0 10px"><label style="display:block;margin:10px 0 5px">Recovery code</label><input id="ownerRecoveryCode" autocomplete="one-time-code" style="width:100%;height:44px;background:#091321;border:1px solid #33445f;border-radius:9px;color:#fff;padding:0 10px;text-transform:uppercase"><button type="button" id="ownerRecoverySubmit" style="width:100%;height:44px;margin-top:14px;border:0;border-radius:9px;background:#3273ee;color:#fff;font-weight:700">Recover owner access</button><p id="ownerRecoveryError" style="min-height:18px;color:#ff94a5"></p>');
    document.getElementById('ownerRecoverySubmit').onclick=async function(){var button=this,error=document.getElementById('ownerRecoveryError');button.disabled=true;error.textContent='';try{await recoveryLogin(document.getElementById('ownerRecoveryEmail').value.trim(),document.getElementById('ownerRecoveryPassword').value,document.getElementById('ownerRecoveryCode').value,true);location.reload();}catch(e){error.textContent=e.message||'Recovery failed.';}finally{button.disabled=false;}};
    return dialog;
  }
  function addButton(host,id,label,handler,secondary){
    if(!host||document.getElementById(id))return;
    var button=document.createElement('button');button.type='button';button.id=id;button.textContent=label;
    button.style.cssText='width:100%;height:44px;margin-top:10px;border-radius:9px;font-weight:700;'+(secondary?'border:1px solid #3a4d69;background:#101c2f;color:#dfe9f8;':'border:0;background:#3273ee;color:#fff;');
    button.onclick=handler;host.appendChild(button);
  }
  function enhanceSignedOut(){
    if(!window.PublicKeyCredential)return;
    var landing=document.getElementById('authForm');
    if(landing&&landing.parentElement){
      var holder=document.getElementById('ownerPasskeyLanding');
      if(!holder){holder=document.createElement('div');holder.id='ownerPasskeyLanding';holder.style.cssText='margin:0 0 14px';landing.parentElement.insertBefore(holder,landing);}
      addButton(holder,'ownerPasskeyLogin','Owner: use Face ID / passkey',async function(){var b=this;b.disabled=true;try{await passkeyLogin(true);location.reload();}catch(e){notify(e.message||'Passkey sign-in failed.');}finally{b.disabled=false;}},false);
      addButton(holder,'ownerRecoveryLogin','Owner recovery code',function(){showRecoveryForm();},true);
    }
    var title=document.getElementById('asUtilityTitle'),form=document.getElementById('asAuthForm');
    if(title&&form&&/sign in/i.test(title.textContent||'')){
      var appHolder=document.getElementById('ownerPasskeyAppLogin');
      if(!appHolder){appHolder=document.createElement('div');appHolder.id='ownerPasskeyAppLogin';form.parentElement.insertBefore(appHolder,form);}
      addButton(appHolder,'ownerPasskeyAppButton','Owner: Face ID / passkey',async function(){var b=this;b.disabled=true;try{await passkeyLogin(true);location.reload();}catch(e){notify(e.message||'Passkey sign-in failed.');}finally{b.disabled=false;}},false);
      addButton(appHolder,'ownerRecoveryAppButton','Use owner recovery code',function(){showRecoveryForm();},true);
    }
  }
  async function enhanceOwnerPanel(){
    var dialog=document.getElementById('asUtility'),title=document.getElementById('asUtilityTitle');
    if(!dialog||!dialog.open||!title||!/your account/i.test(title.textContent||'')||document.getElementById('ownerPasskeySecurity')||panelBusy)return;
    panelBusy=true;
    try{
      var me=await accountMe(false);if(!me||!me.authenticated||!me.user||me.user.role!=='owner')return;
      var section=document.createElement('section');section.id='ownerPasskeySecurity';section.style.cssText='margin-top:18px;padding-top:16px;border-top:1px solid #2b3a51';
      section.innerHTML='<h3 style="margin:0 0 6px">Owner security</h3><p style="color:#91a3ba;font-size:13px">'+(me.user.passkeyEnabled?'Passkey protection is on. Password-only owner sessions are blocked.':'Add a passkey to use Face ID / Touch ID and block password-only owner sessions.')+'</p><p style="color:#91a3ba;font-size:12px">Passkeys: '+(me.user.passkeyCount||0)+' · Recovery codes remaining: '+(me.user.recoveryCodesRemaining||0)+'</p>';
      dialog.appendChild(section);
      addButton(section,'ownerAddPasskey',me.user.passkeyEnabled?'Add another passkey':'Add Face ID / passkey',async function(){var b=this;b.disabled=true;try{await registerPasskey();setTimeout(function(){location.reload();},600);}catch(e){notify(e.message||'Passkey enrollment failed.');}finally{b.disabled=false;}},false);
    }finally{panelBusy=false;}
  }

  // If a correct owner password reaches the server after passkey enrollment,
  // the server refuses to create a session and asks for WebAuthn. Upgrade that
  // response in-place so the existing login forms automatically open Face ID /
  // Touch ID without either form needing to know about this security layer.
  window.fetch=async function(input,init){
    var response=await nativeFetch(input,init);
    try{
      var method=String(init&&init.method||'GET').toUpperCase();
      var raw=typeof input==='string'?input:(input&&input.url)||'';
      var pathname=new URL(raw,location.href).pathname;
      if(method==='POST'&&pathname==='/api/account/login'){
        var data=await response.clone().json().catch(function(){return null;});
        if(data&&data.requiresPasskey){
          var remember=false;try{remember=JSON.parse(String(init&&init.body||'{}')).rememberMe===true;}catch{}
          try{
            var signed=await passkeyLogin(remember);
            return new Response(JSON.stringify(signed),{status:200,headers:{'content-type':'application/json','cache-control':'no-store'}});
          }catch(e){
            return new Response(JSON.stringify({ok:false,code:'AUTH_PASSKEY_REQUIRED',requiresPasskey:true,message:e&&e.message||data.message}),{status:401,headers:{'content-type':'application/json','cache-control':'no-store'}});
          }
        }
      }
    }catch{}
    return response;
  };

  window.ObligeOwnerSecurity={login:passkeyLogin,register:registerPasskey,recover:recoveryLogin};
  function enhance(){enhanceSignedOut();enhanceOwnerPanel();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',enhance,{once:true});else enhance();
  new MutationObserver(function(){setTimeout(enhance,0);}).observe(document.documentElement,{subtree:true,childList:true});
})();

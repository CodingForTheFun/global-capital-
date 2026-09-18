'use client';
import * as React from 'react';
import { Download, X } from 'lucide-react';

type InstallEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

export function AppInstall() {
  const dialog = React.useRef<HTMLDialogElement>(null);
  const [event, setEvent] = React.useState<InstallEvent | null>(null);
  const [installed, setInstalled] = React.useState(false);
  const [offline, setOffline] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState('');
  React.useEffect(() => {
    const display = window.matchMedia('(display-mode: standalone)');
    const sync = () => setInstalled(display.matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
    const connectivity = () => setOffline(!navigator.onLine);
    const capture = (e: Event) => { e.preventDefault(); setEvent(e as InstallEvent); };
    const completed = () => { setInstalled(true); setEvent(null); dialog.current?.close(); };
    sync(); connectivity();
    display.addEventListener('change', sync);
    window.addEventListener('beforeinstallprompt', capture);
    window.addEventListener('appinstalled', completed);
    window.addEventListener('online', connectivity);
    window.addEventListener('offline', connectivity);
    if ('serviceWorker' in navigator && window.isSecureContext) {
      navigator.serviceWorker.register('/app-worker.js', { scope: '/', updateViaCache: 'none' }).catch(() => {
        // A blocked worker never blocks sign-in, props or the web application.
      });
    }
    if (new URLSearchParams(window.location.search).get('install') === '1' && !display.matches) dialog.current?.showModal();
    return () => {
      display.removeEventListener('change', sync);
      window.removeEventListener('beforeinstallprompt', capture);
      window.removeEventListener('appinstalled', completed);
      window.removeEventListener('online', connectivity);
      window.removeEventListener('offline', connectivity);
    };
  }, []);

  async function install() {
    if (!event || busy) return;
    setBusy(true); setMessage('');
    try {
      await event.prompt();
      const choice = await event.userChoice;
      setEvent(null);
      setMessage(choice.outcome === 'accepted' ? 'Installation accepted. Look for Oblige Props on your device.' : 'Installation dismissed. You can continue using the website.');
    } catch { setMessage('Use your browser menu to add Oblige Props to your Home Screen.'); }
    finally { setBusy(false); }
  }

  return <>
    {offline && <p className="op-offline" role="status">Offline — live lines and account changes require a connection.</p>}
    {!installed && <div className="op-install-entry"><button type="button" onClick={() => dialog.current?.showModal()}><Download size={17} aria-hidden="true" /> Install Oblige Props</button><span>Same account. Home Screen access.</span></div>}
    <dialog ref={dialog} className="op-install-dialog" aria-labelledby="op-install-title">
      <button type="button" className="op-install-close" aria-label="Close installation instructions" onClick={() => dialog.current?.close()}><X size={20} /></button>
      <div className="op-install-mark" aria-hidden="true">OP</div>
      <h2 id="op-install-title">Oblige Props, on your Home Screen.</h2>
      <p>Open your research board in its own app window. Use your existing account; live data still requires an internet connection.</p>
      {event && <button type="button" className="op-install-primary" disabled={busy} onClick={install}>{busy ? 'Opening installer…' : 'Install app'}</button>}
      <h3>iPhone or iPad</h3>
      <p>Open this site in Safari. Tap <strong>Share → Add to Home Screen</strong>, enable <strong>Open as Web App</strong> when shown, then tap <strong>Add</strong>.</p>
      <h3>Android or desktop</h3>
      <p>Use the Install app button above when available, or open your browser menu and choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.</p>
      <p className="op-install-note">Browser-installed web app. Not an App Store download. Push alerts are not included in this release.</p>
      <p role="status">{message}</p>
    </dialog>
  </>;
}

/* Bazares — banner de instalação (Android/Chrome via beforeinstallprompt).
   iOS fica de fora por agora (o Safari não dispara este evento). */
(function () {
  var deferredPrompt = null;

  function alreadyInstalled() {
    return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  }

  function buildBanner() {
    var el = document.createElement("div");
    el.id = "bz-install-banner";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", "Instalar aplicação Bazares");
    el.style.cssText = [
      "position:fixed", "left:12px", "right:12px", "bottom:12px", "z-index:9999",
      "display:flex", "align-items:center", "gap:12px",
      "background:var(--card,#fff)", "color:var(--t1,#0F172A)",
      "border-radius:var(--rl,18px)", "padding:12px 14px",
      "box-shadow:0 12px 32px rgba(0,0,0,.18)",
      "border:1.5px solid var(--b-200,#A5FDC0)",
      "transform:translateY(120%)", "transition:transform .35s ease",
      "font-family:inherit"
    ].join(";");

    el.innerHTML =
      '<div style="width:44px;height:44px;flex-shrink:0;border-radius:var(--r,12px);overflow:hidden">' +
        '<img src="/icons/icon-192.png" alt="" style="width:100%;height:100%;display:block">' +
      '</div>' +
      '<div style="flex:1;min-width:0">' +
        '<div style="font-weight:700;font-size:14px;line-height:1.2">Instalar o Bazares</div>' +
        '<div style="font-size:12.5px;color:var(--t3,#64748B);margin-top:2px">Acesso rápido, sem Safari/Chrome aberto</div>' +
      '</div>' +
      '<button id="bz-install-go" style="flex-shrink:0;background:var(--g-green,var(--b-600,#00B837));color:#fff;border:0;border-radius:var(--pill,999px);padding:10px 16px;font-weight:700;font-size:13px;cursor:pointer">Instalar</button>' +
      '<button id="bz-install-close" aria-label="Fechar" style="flex-shrink:0;background:transparent;border:0;color:var(--t3,#64748B);font-size:20px;line-height:1;padding:4px 6px;cursor:pointer">&times;</button>';

    document.body.appendChild(el);
    requestAnimationFrame(function () {
      el.style.transform = "translateY(0)";
    });

    document.getElementById("bz-install-close").addEventListener("click", function () {
      dismiss(el);
    });
    document.getElementById("bz-install-go").addEventListener("click", function () {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      deferredPrompt.userChoice.finally(function () {
        deferredPrompt = null;
        hide(el);
      });
    });

    return el;
  }

  function hide(el) {
    el.style.transform = "translateY(120%)";
    setTimeout(function () { el.remove(); }, 350);
  }

  function dismiss(el) {
    hide(el);
  }

  window.addEventListener("beforeinstallprompt", function (e) {
    if (alreadyInstalled()) return;
    e.preventDefault();
    deferredPrompt = e;
    buildBanner();
  });

  window.addEventListener("appinstalled", function () {
    var el = document.getElementById("bz-install-banner");
    if (el) hide(el);
  });
})();

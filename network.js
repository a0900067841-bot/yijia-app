(()=>{
  const update=()=>{
    const el=document.getElementById('networkStatus');
    if(!el)return;
    const online=navigator.onLine;
    el.classList.toggle('is-online',online);
    el.classList.toggle('is-offline',!online);
    el.setAttribute('aria-label',online?'網路連線正常':'目前離線');
    el.setAttribute('title',online?'網路連線正常':'目前離線');
    const text=el.querySelector('.network-status-text');
    if(text)text.textContent=online?'連線':'離線';
  };
  window.addEventListener('online',update);
  window.addEventListener('offline',update);
  document.addEventListener('DOMContentLoaded',()=>{
    update();
    const el=document.getElementById('networkStatus');
    if(el)el.addEventListener('click',()=>{
      alert(navigator.onLine?'🛜 網路連線正常':'🛜 目前離線');
    });
  });
})();
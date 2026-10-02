self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
// No authenticated page or API caching. Offline availability must never look live.
self.addEventListener('push',event=>{
  let data={};try{data=event.data?.json()??{};}catch{}
  event.waitUntil(self.registration.showNotification(data.title||'Lightning Lane update',{
    body:data.body||'Open the app for details.',icon:'/icon.svg',tag:data.tag||'lightning-lane',data:{url:'/'},
  }));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async clients=>{
    for(const client of clients)if(new URL(client.url).origin===self.location.origin){await client.focus();return;}
    await self.clients.openWindow('/');
  }));
});

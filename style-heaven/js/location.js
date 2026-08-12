async function lookupPincode(pin, ids={pin:'co_pin',city:'co_city',state:'co_state',area:'co_area',msg:'locationMsg'}){
  const p=document.getElementById(ids.pin); if(!p)return;
  const value=p.value.trim(); const msg=document.getElementById(ids.msg);
  if(!/^[1-9]\d{5}$/.test(value)){ if(msg){msg.textContent='Enter a valid 6-digit PIN code.';msg.className='msg err show'} return; }
  if(msg){msg.textContent='Finding your city…';msg.className='msg show'}
  try{const d=await api(`/api/location/pincode/${value}`); if(document.getElementById(ids.city))document.getElementById(ids.city).value=d.city||''; if(document.getElementById(ids.state))document.getElementById(ids.state).value=d.state||''; if(document.getElementById(ids.area))document.getElementById(ids.area).value=d.area||''; if(msg){msg.textContent=`Location found: ${d.city}, ${d.state}`;msg.className='msg show'}}catch(e){if(msg){msg.textContent=e.message;msg.className='msg err show'}}
}
function useCurrentLocation(targets={pin:'co_pin',city:'co_city',state:'co_state',area:'co_area',lat:'co_latitude',lon:'co_longitude',msg:'locationMsg'}){
  const msg=document.getElementById(targets.msg);
  if(!navigator.geolocation){if(msg){msg.textContent='Location is not supported by this browser.';msg.className='msg err show'}return;}
  if(msg){msg.textContent='Requesting your location…';msg.className='msg show'}
  navigator.geolocation.getCurrentPosition(async pos=>{
    const {latitude,longitude}=pos.coords;
    try{const d=await api(`/api/location/reverse?lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}`); const a=d.address||{}; const set=(id,v)=>{const el=document.getElementById(id);if(el&&v)el.value=v}; set(targets.city,a.city);set(targets.state,a.state);set(targets.pin,a.pin);set(targets.area,a.area);set(targets.lat,latitude);set(targets.lon,longitude); if(msg){msg.textContent=a.city?`Location detected: ${a.city}, ${a.state}`:'Location detected. Please confirm your PIN/address.';msg.className='msg show'}}catch(e){if(msg){msg.textContent='We detected your location, but could not fill the address automatically. Enter your PIN to continue.';msg.className='msg err show'} const lat=document.getElementById(targets.lat);const lon=document.getElementById(targets.lon);if(lat)lat.value=latitude;if(lon)lon.value=longitude;}
  },()=>{if(msg){msg.textContent='Location permission was not granted. You can still enter your PIN manually.';msg.className='msg err show'}},{enableHighAccuracy:true,timeout:10000,maximumAge:300000});
}

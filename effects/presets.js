export const finishes={silver:{name:'Polished silver',color:'#b7bebd',roughness:.20},carbon:{name:'Carbon black',color:'#343b35',roughness:.27},ion:{name:'Ion blue',color:'#2354ff',roughness:.20}};
export const defaults={finish:'silver',intensity:.65,speed:.35,quality:'auto',still:false};
export function normalizePreset(value){
  if(!value||typeof value!=='object')return {...defaults};
  const unit=(v,fallback)=>typeof v==='number'&&Number.isFinite(v)?Math.min(1,Math.max(0,v)):fallback;
  return {finish:Object.hasOwn(finishes,value.finish)?value.finish:defaults.finish,intensity:unit(value.intensity,defaults.intensity),speed:unit(value.speed,defaults.speed),quality:['auto','eco','high'].includes(value.quality)?value.quality:defaults.quality,still:value.still===true};
}

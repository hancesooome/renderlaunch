import {useEffect, useState} from 'react';
import {loadAssetBlob} from '../persistence/database';

export function useAssetUrl(assetId?: string) {
  const [state,setState]=useState<{url?:string;status:'idle'|'loading'|'ready'|'missing'|'error'}>({status:'idle'});
  useEffect(()=>{
    let active=true, objectUrl:string|undefined;
    if (!assetId) { setState({status:'idle'}); return; }
    setState({status:'loading'});
    void loadAssetBlob(assetId).then(blob=>{
      if (!active) return;
      if(!blob){setState({status:'missing'});return;}
      objectUrl=URL.createObjectURL(blob); setState({url:objectUrl,status:'ready'});
    }).catch(()=>{if(active)setState({status:'error'})});
    return ()=>{active=false;if(objectUrl)URL.revokeObjectURL(objectUrl)};
  },[assetId]);
  return state;
}

import {useEffect, useState} from 'react';
import {loadAssetBlob} from '../persistence/database';

export function useAssetUrl(assetId?: string) {
  const [url,setUrl]=useState<string>();
  useEffect(()=>{
    let active=true, objectUrl:string|undefined;
    if (!assetId) { setUrl(undefined); return; }
    void loadAssetBlob(assetId).then(blob=>{
      if (!active || !blob) return;
      objectUrl=URL.createObjectURL(blob); setUrl(objectUrl);
    });
    return ()=>{active=false;if(objectUrl)URL.revokeObjectURL(objectUrl)};
  },[assetId]);
  return url;
}

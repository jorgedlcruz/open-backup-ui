'use client'
// Open Backup UI v1.2.0
import {createContext,useContext,useEffect,useRef,useState,type ReactNode} from 'react'
import {useI18n} from '@/components/providers/i18n-provider'
import {useRouter} from 'next/navigation'
import {isLensId,lenses,type LensId} from '@/lib/lens/navigation'

type Preference={defaultView:LensId;saving:LensId|null;error:string;message:string;save:(view:LensId)=>Promise<void>}
const Context=createContext<Preference|null>(null)
export function LensPreferences({initialDefault,children}:{initialDefault:LensId;children:ReactNode}){
  const {t}=useI18n()
  const [defaultView,setDefaultView]=useState(initialDefault),[saving,setSaving]=useState<LensId|null>(null),[error,setError]=useState(''),[message,setMessage]=useState(''),pending=useRef(false),router=useRouter()
  useEffect(()=>setDefaultView(initialDefault),[initialDefault])
  const save=async(view:LensId)=>{
    if(pending.current||view===defaultView)return
    pending.current=true;setSaving(view);setError('');setMessage('')
    try{
      const response=await fetch('/api/settings/protection-lens',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({defaultView:view})}),data=await response.json()
      if(!response.ok)throw new Error(data.error==='Change your default Lens from this application.'?t('Change your default Lens from this application.'):data.error==='Choose a valid default Lens.'?t('Choose a valid default Lens.'):data.error||t('Your default view could not be saved.'))
      if(!isLensId(data.defaultView))throw new Error(t('The default view could not be confirmed. Reload and try again.'))
      setDefaultView(data.defaultView);setMessage(t('{view} will open after sign-in, in this browser.',{view:t(lenses.find(l=>l.id===data.defaultView)!.title)}))
      // Invalidate any cached landing redirect that used the previous cookie.
      router.refresh()
    }catch(e){setError(e instanceof Error?e.message:t('Your default view could not be saved. Try again.'))}
    finally{pending.current=false;setSaving(null)}
  }
  return <Context.Provider value={{defaultView,saving,error,message,save}}>{children}</Context.Provider>
}
export function useLensPreference(){const value=useContext(Context);if(!value)throw new Error('Lens views require their preference provider.');return value}

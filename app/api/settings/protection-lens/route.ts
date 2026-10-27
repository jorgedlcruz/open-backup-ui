import {NextRequest,NextResponse} from 'next/server'
import {cookies} from 'next/headers'
import {defaultLens,isLensId,lensCookie} from '@/lib/lens/navigation'

export const dynamic='force-dynamic'
const headers={'Cache-Control':'private, no-store'}
export async function GET(){return NextResponse.json({defaultView:defaultLens((await cookies()).get(lensCookie)?.value)},{headers})}
export async function PUT(request:NextRequest){
  const origin=request.headers.get('origin')
  if(origin&&origin!==request.nextUrl.origin||request.headers.get('sec-fetch-site')==='cross-site')return NextResponse.json({error:'Change your default Lens from this application.'},{status:403,headers})
  const raw=await request.text()
  let value:unknown
  try{if(raw.length>1000)throw new Error();value=JSON.parse(raw)}catch{return NextResponse.json({error:'Choose a valid default Lens.'},{status:400,headers})}
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>key!=='defaultView')||!isLensId((value as {defaultView?:unknown}).defaultView))return NextResponse.json({error:'Choose a valid default Lens.'},{status:400,headers})
  const view=(value as {defaultView:string}).defaultView,response=NextResponse.json({defaultView:view},{headers})
  response.cookies.set(lensCookie,view,{httpOnly:true,path:'/',sameSite:'lax',secure:request.nextUrl.protocol==='https:',maxAge:365*24*60*60})
  return response
}

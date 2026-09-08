import {requireOperator} from '@/lib/server/access';
export function GET(request:Request) {
  const denied=requireOperator(request);
  if(denied)return denied;
  return new Response(null,{status:303,headers:{Location:'/admin','Cache-Control':'no-store'}});
}

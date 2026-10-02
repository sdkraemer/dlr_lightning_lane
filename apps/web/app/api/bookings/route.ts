import {authorize} from '../../../lib/auth';
import {db} from '../../../lib/db';
import {saveBooking,setBookingState} from '../../../../../packages/core/bookings.ts';
export async function POST(request:Request) {
  const denied=await authorize(request,true);if(denied)return denied;
  try {
    if(Number(request.headers.get('content-length')??0)>10_000) return Response.json({error:'Request too large.'},{status:413});
    const body=await request.json();
    if(body.id!==undefined&&(!Number.isSafeInteger(body.id)||body.id<1))throw new Error('Invalid booking ID.');
    if(body.action==='state') {
      if(body.id===undefined)throw new Error('Booking ID required.');
      setBookingState(db(),body.id,body.state);return Response.json({ok:true});
    }
    const id=saveBooking(db(),body.booking,body.id);
    return Response.json({id});
  } catch(e) {return Response.json({error:e instanceof Error?e.message:'Invalid booking.'},{status:400});}
}

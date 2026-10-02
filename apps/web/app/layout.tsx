import type {Metadata,Viewport} from 'next';
import './styles.css';
export const metadata:Metadata={title:'My Lightning Lanes',description:'Your Disneyland return-time watch.',manifest:'/manifest.webmanifest',icons:{icon:'/icon.svg'}};
export const viewport:Viewport={width:'device-width',initialScale:1,themeColor:'#163d39'};
export default function Layout({children}:{children:React.ReactNode}) {return <html lang="en"><body>{children}</body></html>;}

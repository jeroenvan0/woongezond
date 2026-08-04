import { NextResponse } from 'next/server'

const KEY = process.env.OPENWEATHER_API_KEY
let weatherCache: { data: any; expires: number } = { data: null, expires: 0 }
let pollCache:    { data: any; expires: number } = { data: null, expires: 0 }

function dewpoint(t: number, rh: number) {
  const a=17.625,b=243.04,g=(a*t/(b+t))+Math.log(Math.max(rh,0.1)/100)
  return (b*g)/(a-g)
}

export async function GET() {
  if (!KEY) return NextResponse.json({ weather: null, pollution: null })
  const LAT = '52.37', LON = '4.89'
  const now = Date.now()

  if (now > weatherCache.expires) {
    try {
      const r = await fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${LAT}&lon=${LON}&units=metric&lang=nl&appid=${KEY}`, { next: { revalidate: 600 } })
      const d = await r.json()
      const m=d.main??{}, w=d.wind??{}, rain=d.rain??{}, wx=(d.weather??[{}])[0]??{}
      weatherCache = { expires: now+600000, data: {
        temp:m.temp, feelsLike:m.feels_like, humidity:m.humidity,
        pressure:m.pressure, windSpeed:w.speed,
        description:(wx.description??'').replace(/^\w/,(c:string)=>c.toUpperCase()),
        iconCode:wx.icon??'01d', cityName:d.name??'',
        precipitation1h:rain['1h']??0,
        outdoorDewpoint:m.temp!=null&&m.humidity?dewpoint(m.temp,m.humidity):null
      }}
    } catch { weatherCache = { expires: now+60000, data: null } }
  }

  if (now > pollCache.expires) {
    try {
      const r = await fetch(`https://api.openweathermap.org/data/2.5/air_pollution?lat=${LAT}&lon=${LON}&appid=${KEY}`, { next: { revalidate: 900 } })
      const d = await r.json()
      const e=(d.list??[{}])[0]??{}, c=e.components??{}
      pollCache = { expires: now+900000, data: { aqi:e.main?.aqi, pm2_5:c.pm2_5, pm10:c.pm10, no2:c.no2, o3:c.o3 } }
    } catch { pollCache = { expires: now+60000, data: null } }
  }

  return NextResponse.json({ weather: weatherCache.data, pollution: pollCache.data })
}

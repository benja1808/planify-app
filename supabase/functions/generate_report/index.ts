import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Modelos a intentar en orden de preferencia (API v1beta)
const MODELOS_PREFERIDOS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
  'gemini-1.5-flash-001',
]

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { prompt } = await req.json()

    if (!prompt) {
      throw new Error('El campo "prompt" es requerido.')
    }

    const apiKey = Deno.env.get('GEMINI_API_KEY')
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY no está configurado en los secretos de Supabase.')
    }

    // Intentar cada modelo hasta que uno funcione
    let reporteGenerado: string | null = null
    let ultimoError = ''

    for (const modelo of MODELOS_PREFERIDOS) {
      try {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${apiKey}`

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: 8192, temperature: 0.7 }
          })
        })

        if (!response.ok) {
          const err = await response.json().catch(() => ({}))
          ultimoError = err?.error?.message || `HTTP ${response.status}`
          continue // probar siguiente modelo
        }

        const data = await response.json()
        reporteGenerado = data?.candidates?.[0]?.content?.parts?.[0]?.text || null

        if (reporteGenerado) break // éxito

      } catch (e) {
        ultimoError = String(e)
        continue
      }
    }

    if (!reporteGenerado) {
      throw new Error(`No se pudo generar el informe con ningún modelo disponible. Último error: ${ultimoError}`)
    }

    return new Response(
      JSON.stringify({ report: reporteGenerado }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})

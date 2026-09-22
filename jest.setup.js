// Variables de entorno dummy para que los módulos de configuración (supabase.ts,
// stripe.ts, maps.service.ts) no lancen error al importarse en los tests.
// Ningún test hace llamadas de red reales: Supabase, Stripe y Google Maps se
// mockean en cada spec. Estos valores solo evitan el "throw" en tiempo de import.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://test.supabase.co";
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "test-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "test-service-role-key";
process.env.GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || "test-google-maps-key";
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_dummy0000000000000000000000000";

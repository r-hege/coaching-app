// Verbindung zur Datenbank (Supabase).
// Der "anon/publishable key" ist dafür gedacht, in der App zu stehen –
// die Daten schützt der Login + die Zeilen-Regeln (RLS) in der Datenbank.
// Leer lassen = lokaler Testmodus (Daten nur in diesem Browser).
window.APP_CONFIG = {
  supabaseUrl: 'https://lqspluwlyzclijaljwkg.supabase.co',
  supabaseKey: 'sb_publishable_touM0ZUqZy6HKoJhm2lF5w_XH4HCxAx'
};

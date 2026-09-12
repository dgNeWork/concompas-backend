import { Injectable } from "@nestjs/common";
import { supabase, supabaseAdmin } from "./supabase";

// Envoltorio inyectable sobre los clientes de Supabase ya creados en supabase.ts.
// No duplica la creación de clientes ni la validación de variables de entorno
// (eso sigue viviendo en supabase.ts, que falla rápido si faltan credenciales).
// Solo existe para que los servicios de Nest puedan recibir el acceso a Supabase
// por inyección de dependencias (principio DIP) en lugar de importar los clientes
// directamente, lo que facilita sustituirlos por mocks en tests.
@Injectable()
export class SupabaseService {
  readonly client = supabase;
  readonly admin = supabaseAdmin;
}

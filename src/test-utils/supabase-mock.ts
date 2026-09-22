// Utilidad compartida para mockear el query builder encadenable de Supabase
// (.from().select().eq().single(), etc.) en los tests unitarios de los servicios.
//
// El cliente real de supabase-js es "thenable": cada método de la cadena
// devuelve el propio builder, y al hacer `await` en cualquier punto de la
// cadena se resuelve con { data, error }. Replicamos ese comportamiento aquí
// para no acoplar los tests a una cadena de mocks distinta por cada test.

export type SupabaseResult<T = unknown> = { data: T; error: { message: string } | null };

export interface SupabaseQueryBuilderMock {
  select: jest.Mock;
  insert: jest.Mock;
  update: jest.Mock;
  delete: jest.Mock;
  eq: jest.Mock;
  neq: jest.Mock;
  in: jest.Mock;
  order: jest.Mock;
  limit: jest.Mock;
  lte: jest.Mock;
  gte: jest.Mock;
  single: jest.Mock;
  then: (resolve: (value: SupabaseResult) => unknown, reject?: (reason: unknown) => unknown) => unknown;
}

// Crea un builder encadenable que se resuelve con `result` en cualquier punto
// de la cadena (igual que hace el cliente real de Supabase).
export function createQueryBuilder<T = unknown>(result: SupabaseResult<T>): SupabaseQueryBuilderMock {
  const builder = {} as SupabaseQueryBuilderMock;
  const chainMethods: (keyof SupabaseQueryBuilderMock)[] = [
    "select",
    "insert",
    "update",
    "delete",
    "eq",
    "neq",
    "in",
    "order",
    "limit",
    "lte",
    "gte",
    "single",
  ];

  for (const method of chainMethods) {
    (builder[method] as jest.Mock) = jest.fn(() => builder);
  }

  builder.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);

  return builder;
}

export function ok<T>(data: T): SupabaseResult<T> {
  return { data, error: null };
}

export function fail(message: string): SupabaseResult<null> {
  return { data: null, error: { message } };
}

// Mock de SupabaseService (config/supabase.service.ts) con .client y .admin.
// Cada test configura `admin.from` / `client.auth...` con mockReturnValueOnce
// o mockImplementation según necesite responder distinto por tabla/llamada.
export function createSupabaseServiceMock() {
  const admin = {
    from: jest.fn(),
    auth: {
      admin: {
        createUser: jest.fn(),
        deleteUser: jest.fn(),
        signOut: jest.fn(),
      },
      getUser: jest.fn(),
    },
  };

  const client = {
    auth: {
      signInWithPassword: jest.fn(),
    },
  };

  return { admin, client } as const;
}

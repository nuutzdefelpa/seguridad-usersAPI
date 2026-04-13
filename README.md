# usersAPI

API sencilla en NestJS para el ERP. Usa Supabase Auth para login y registro, y la base de datos de Supabase para perfiles y gestión de usuarios.

## Variables de entorno

Crea un archivo `.env` a partir de `.env.example`:

```env
PORT=3001
FRONTEND_ORIGIN=http://localhost:4200
SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_ANON_KEY=tu-anon-key
SUPABASE_SERVICE_ROLE_KEY=tu-service-role-key
# o bien:
# SUPABASE_SECRET_KEY=tu-secret-key
```

Notas:

- `SUPABASE_ANON_KEY` se usa para `login` y validación de tokens.
- `SUPABASE_SERVICE_ROLE_KEY` se usa para crear perfiles y consultar permisos.
- Si en tu panel solo aparece `secret key`, úsala como `SUPABASE_SECRET_KEY`; esta API ya acepta ambos nombres.
- No expongas `SUPABASE_SERVICE_ROLE_KEY` en el frontend.

## Instalación

```bash
npm install
```

## Ejecutar

```bash
npm run start:dev
```

La API queda disponible en `http://localhost:3001/api`.

## Endpoints

### `POST /api/auth/register`

```json
{
  "usuario": "jdoe",
  "fullName": "John Doe",
  "email": "jdoe@empresa.com",
  "password": "1234*Apass",
  "dob": "1990-05-15",
  "phone": "+525512345678",
  "address": "Av. Reforma 123"
}
```

Comportamiento:

- Crea el usuario en Supabase Auth.
- Crea el perfil en la tabla `users`.
- Asigna los permisos por defecto que ya usa el frontend del ERP.
- Devuelve la sesión y el perfil efectivo.

### `POST /api/auth/login`

```json
{
  "email": "jdoe@empresa.com",
  "password": "1234*Apass"
}
```

También acepta username en el campo `email`, para encajar con el login actual del frontend.

### `GET /api/auth/me`

Requiere header:

```http
Authorization: Bearer <supabase_access_token>
```

### `GET /api/users`

Requiere bearer token. Devuelve el listado de usuarios con su payload efectivo.

### `GET /api/users/:userId`

Requiere bearer token. Devuelve el detalle de un usuario.

### `POST /api/users`

Requiere bearer token. Crea un usuario usando la misma estructura de `register`, pero pensado para administración.

### `PATCH /api/users/:userId`

Requiere bearer token. Actualiza el perfil de un usuario.

### `DELETE /api/users/:userId`

Requiere bearer token. Elimina el perfil y, si se localiza, también el usuario en Supabase Auth.

## Flujo pensado para el ERP

- El frontend puede dejar de usar el login mock y llamar a `POST /api/auth/login`.
- Después del login, usa el `accessToken` de Supabase como bearer token contra esta API.
- La gestión de grupos ya no vive aquí; ahora corresponde a `groupsAPI`.
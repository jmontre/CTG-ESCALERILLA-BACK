import { getAuthCookieOptions } from './auth.controller';

describe('getAuthCookieOptions', () => {
  it('usa domain=.clubdetenisgraneros.cl y SameSite=Lax en el dominio de producción', () => {
    expect(getAuthCookieOptions('api.clubdetenisgraneros.cl')).toEqual({
      httpOnly: true,
      secure: true,
      path: '/',
      sameSite: 'lax',
      domain: '.clubdetenisgraneros.cl',
    });
  });

  it('usa domain=.clubdetenisgraneros.cl también en el dominio raíz sin subdominio', () => {
    expect(getAuthCookieOptions('clubdetenisgraneros.cl')).toEqual({
      httpOnly: true,
      secure: true,
      path: '/',
      sameSite: 'lax',
      domain: '.clubdetenisgraneros.cl',
    });
  });

  it('usa domain=.clubdetenisgraneros.cl también en subdominios de staging bajo el dominio propio', () => {
    // Una vez que staging tenga su propio subdominio (ej. staging-api.clubdetenisgraneros.cl),
    // cae en el mismo caso que producción: dominio padre compartido, sin necesidad de SameSite=None.
    expect(getAuthCookieOptions('staging-api.clubdetenisgraneros.cl')).toEqual({
      httpOnly: true,
      secure: true,
      path: '/',
      sameSite: 'lax',
      domain: '.clubdetenisgraneros.cl',
    });
  });

  it('omite domain y mantiene SameSite=Lax en localhost (dev, mismo site distinto puerto)', () => {
    // localhost:3000 (API) y localhost:3001 (frontend) son mismo "site" (mismo dominio
    // registrable, el puerto no cuenta) — Lax alcanza, no hace falta SameSite=None.
    expect(getAuthCookieOptions('localhost')).toEqual({
      httpOnly: true,
      secure: true,
      path: '/',
      sameSite: 'lax',
    });
  });

  it('omite domain y mantiene SameSite=Lax si el host no viene definido', () => {
    expect(getAuthCookieOptions(undefined)).toEqual({
      httpOnly: true,
      secure: true,
      path: '/',
      sameSite: 'lax',
    });
  });

  it('omite domain en un host ajeno a clubdetenisgraneros.cl (ej. Railway sin subdominio propio todavía)', () => {
    // Cross-site real (vercel.app <-> up.railway.app): SameSite=Lax NO alcanza para que la
    // cookie viaje en fetch/XHR cross-site, pero tampoco usamos SameSite=None (rompe Safari
    // iOS / Samsung Internet). Login queda limitado hasta que ese host tenga su propio
    // subdominio de clubdetenisgraneros.cl — comportamiento conocido y aceptado, no un bug.
    expect(
      getAuthCookieOptions('ctg-escalerilla-back-staging.up.railway.app'),
    ).toEqual({
      httpOnly: true,
      secure: true,
      path: '/',
      sameSite: 'lax',
    });
  });
});

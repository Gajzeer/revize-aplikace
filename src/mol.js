// MOL (klient PIK): každá stanice musí mít revize hotové do konce roku
export function molRok(db, Y) {
  const pik = db.klienti.find((k) => k.zkratka === 'PIK')
  const objs = new Set(db.objekty.filter((o) => o.klient_id === pik?.id).map((o) => o.id))
  const end = `${Y}-12-31`
  const rv = db.revize.filter((r) => objs.has(r.objekt_id) && r.stav !== 'archiv')
  const letos = (r) => (r.posledni || '').startsWith(String(Y))
  const zbyva = rv.filter((r) => r.pristi && r.pristi <= end && !letos(r))
  const hotovo = rv.filter(letos)
  const sum = (l) => l.reduce((a, r) => a + Number(r.cena || 0), 0)
  return {
    zbyva,
    hotovo,
    sumZ: sum(zbyva),
    sumH: sum(hotovo),
    stanicZ: new Set(zbyva.map((r) => r.objekt_id)).size,
    stanicH: new Set(hotovo.map((r) => r.objekt_id)).size,
  }
}

export const cekaFakturace = (db) => db.revize.filter((r) => r.stav === 'ceka_fakturace')

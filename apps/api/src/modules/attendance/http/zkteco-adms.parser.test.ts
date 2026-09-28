import { describe, expect, it } from 'vitest';

import { admsOptionsResponse, parseAdmsBody } from './zkteco-adms.parser';

describe('parseAdmsBody', () => {
  it('interpreta una línea table=options con coma dentro de un valor', () => {
    const line =
      '~DeviceName=SenseFace 2A,MAC=00:00:00:00:00:01,Vendor=ACME CO., LTD.,FWVersion=X-1';

    const [record] = parseAdmsBody('options', line);

    expect(record).toEqual({
      kind: 'entry',
      prefix: 'options',
      fields: {
        DeviceName: 'SenseFace 2A',
        MAC: '[redactado:17]',
        Vendor: '[redactado:14]',
        FWVersion: 'X-1',
      },
    });
  });

  it('es insensible a mayúsculas en el nombre de la tabla options', () => {
    const [record] = parseAdmsBody('OPTIONS', '~DeviceName=SenseFace 2A');

    expect(record).toMatchObject({ kind: 'entry', prefix: 'options' });
  });

  it('interpreta dos líneas ATTLOG con tab final', () => {
    const body =
      '1\t2026-09-28 08:01:00\t0\t1\t0\t0\t0\t0\t0\t0\t\n' +
      '2\t2026-09-28 08:02:00\t0\t15\t0\t0\t0\t0\t0\t0\t\n';

    const records = parseAdmsBody('ATTLOG', body);

    expect(records).toEqual([
      {
        kind: 'attendance',
        pin: '1',
        deviceTime: '2026-09-28 08:01:00',
        status: '0',
        verifyMode: '1',
        extraFields: 6,
      },
      {
        kind: 'attendance',
        pin: '2',
        deviceTime: '2026-09-28 08:02:00',
        status: '0',
        verifyMode: '15',
        extraFields: 6,
      },
    ]);
  });

  it('marca una línea ATTLOG sin PIN ni hora como no interpretada', () => {
    const [record] = parseAdmsBody('ATTLOG', 'solo-un-campo\n');

    expect(record).toEqual({ kind: 'unparsed', length: 'solo-un-campo'.length });
  });

  it('interpreta una línea OPLOG como operation', () => {
    const [record] = parseAdmsBody('OPERLOG', 'OPLOG 7\t0\t2026-09-28 10:47:19\t1\t0\t0\t0');

    expect(record).toEqual({
      kind: 'operation',
      code: '7',
      adminPin: '0',
      deviceTime: '2026-09-28 10:47:19',
      objects: ['1', '0', '0', '0'],
    });
  });

  it('interpreta una línea USER dentro de OPERLOG como entry con Name y Passwd redactados', () => {
    const line = 'USER PIN=1\tName=Prueba\tPri=0\tPasswd=1234\tCard=\tGrp=1';

    const [record] = parseAdmsBody('OPERLOG', line);

    expect(record).toEqual({
      kind: 'entry',
      prefix: 'USER',
      fields: {
        PIN: '1',
        Name: '[redactado:6]',
        Pri: '0',
        Passwd: '[redactado:4]',
        Card: '[redactado:0]',
        Grp: '1',
      },
    });
  });

  it('interpreta una línea BIODATA con Tmp redactado y el resto en claro', () => {
    const tmp = 'x'.repeat(100);
    const line = `BIODATA Pin=1\tNo=6\tIndex=0\tValid=1\tDuress=0\tType=1\tMajorVer=13\tMinorVer=0\tFormat=0\tTmp=${tmp}`;

    const [record] = parseAdmsBody('BIODATA', line);

    expect(record).toEqual({
      kind: 'entry',
      prefix: 'BIODATA',
      fields: {
        Pin: '1',
        No: '6',
        Index: '0',
        Valid: '1',
        Duress: '0',
        Type: '1',
        MajorVer: '13',
        MinorVer: '0',
        Format: '0',
        Tmp: `[redactado:${tmp.length}]`,
      },
    });
  });

  it('interpreta una línea BIOPHOTO con Content y FileName redactados', () => {
    const content = 'y'.repeat(200);
    const line = `BIOPHOTO PIN=1\tNo=0\tIndex=0\tFileName=1.jpg\tType=9\tSize=200\tContent=${content}`;

    const [record] = parseAdmsBody('OPERLOG', line);

    expect(record).toEqual({
      kind: 'entry',
      prefix: 'BIOPHOTO',
      fields: {
        PIN: '1',
        No: '0',
        Index: '0',
        FileName: '[redactado:5]',
        Type: '9',
        Size: '200',
        Content: `[redactado:${content.length}]`,
      },
    });
  });

  it('descarta líneas vacías y el retorno de carro final', () => {
    const records = parseAdmsBody('ATTLOG', '\n\n1\t2026-09-28 08:01:00\t0\t1\t\r\n\n');

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ kind: 'attendance', pin: '1' });
  });

  it('marca como no interpretada una línea sin espacio ni pares clave=valor', () => {
    const [record] = parseAdmsBody('DESCONOCIDA', 'texto-plano-sin-formato');

    expect(record).toEqual({ kind: 'unparsed', length: 'texto-plano-sin-formato'.length });
  });

  it('nunca incluye el contenido crudo de una línea no interpretada', () => {
    const secret = 'dato-que-no-debe-aparecer';
    const [record] = parseAdmsBody('DESCONOCIDA', secret);

    expect(JSON.stringify(record)).not.toContain(secret);
  });
});

describe('admsOptionsResponse', () => {
  it('arma el bloque de opciones con el número de serie en la primera línea', () => {
    const response = admsOptionsResponse('TESTSN001');
    const lines = response.split('\n');

    expect(lines[0]).toBe('GET OPTION FROM: TESTSN001');
    expect(lines).toContain('Delay=10');
    expect(lines).toContain('ATTLOGStamp=None');
  });
});

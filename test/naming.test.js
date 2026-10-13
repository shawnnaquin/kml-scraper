import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nameParser, unwrapCensusName } from '../lib/naming.js';

test('nameParser keeps v1 slugs', () => {
  assert.equal(nameParser('Portland-Auburn, ME'), 'portland-auburn_me');
  assert.equal(nameParser("Coeur d'Alene"), 'coeur_dalene');
  assert.equal(nameParser('Cañon City'), 'canon_city');
  assert.equal(nameParser('Winston-Salem/Greensboro (NC) & "More"'), 'winston-salem-greensboro_nc__more');
  assert.equal(nameParser('District of Columbia'), 'district_of_columbia');
});

test('unwrapCensusName strips the <at><openparen> wrapper', () => {
  assert.equal(unwrapCensusName('<at><openparen>Abanda<closeparen>'), 'Abanda');
  assert.equal(unwrapCensusName('Plain Name'), 'Plain Name');
});

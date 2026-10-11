import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it,vi} from 'vitest';
import {CatalogDefinitionsEditor} from './CatalogDefinitionsEditor';

const categories=[{id:'cat-a',shopId:'shop',slug:'burgers',name:'Burgers',description:null,sortOrder:10,active:true}];
const modifiers=[{id:'mod-a',shopId:'shop',name:'Cheese',priceMinor:200,sortOrder:10,active:true}];

describe('catalog category/modifier management',()=>{
 it('offers create controls and edit/archive affordances in the catalog draft',()=>{
  const html=renderToStaticMarkup(<CatalogDefinitionsEditor shopId="shop" categories={categories}
    modifiers={modifiers} canEdit canPrice pending={false} onSave={vi.fn()}/>);
  expect(html).toContain('Add category');
  expect(html).toContain('Add modifier');
  expect(html).toContain('Edit Burgers');
  expect(html).toContain('Edit Cheese');
  expect(html).toContain('Draft');
 });
 it('does not expose mutating actions without catalog.edit',()=>{
  const html=renderToStaticMarkup(<CatalogDefinitionsEditor shopId="shop" categories={categories}
    modifiers={modifiers} canEdit={false} canPrice={false} pending={false} onSave={vi.fn()}/>);
  expect(html).not.toContain('Add category');
  expect(html).not.toContain('Add modifier');
 });
});

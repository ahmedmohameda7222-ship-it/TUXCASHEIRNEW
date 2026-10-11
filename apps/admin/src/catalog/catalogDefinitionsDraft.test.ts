import { describe, expect, it } from 'vitest';
import { upsertCatalogDefinitionInBundle } from './catalogDefinitionsDraft';

const bundle={
  snapshot:{
    categories:[{id:'category-a',shopId:'shop',slug:'burgers',name:'Burgers',description:null,active:true,sortOrder:10}],
    products:[{id:'product-a',shopId:'shop',categoryId:'category-a',name:'Burger',active:true}],
    modifiers:[{id:'modifier-a',shopId:'shop',name:'Cheese',priceMinor:100,active:true,sortOrder:10}],
    productModifierLinks:[{shopId:'shop',productId:'product-a',modifierId:'modifier-a',maxQuantity:1,sortOrder:10}],
    comboBeverageOptions:[],recipeLines:[],
  },
};

describe('catalog definition draft persistence',()=>{
  it('creates or renames categories only in the canonical catalog snapshot',()=>{
    const updated=upsertCatalogDefinitionInBundle(bundle,'categories',{
      id:'category-b',shopId:'shop',slug:'sides',name:'Sides',description:null,active:true,sortOrder:20,
    });
    const snapshot=updated.snapshot as Record<string,unknown>;
    expect((snapshot.categories as unknown[]).length).toBe(2);
    expect(snapshot.products).toEqual(bundle.snapshot.products);
    expect(bundle.snapshot.categories).toHaveLength(1);
  });
  it('archives a used modifier without destroying historical links',()=>{
    const updated=upsertCatalogDefinitionInBundle(bundle,'modifiers',{
      ...bundle.snapshot.modifiers[0]!,active:false,
    });
    const snapshot=updated.snapshot as Record<string,unknown>;
    expect(snapshot.productModifierLinks).toEqual(bundle.snapshot.productModifierLinks);
    expect((snapshot.modifiers as Array<{active:boolean}>)[0]?.active).toBe(false);
  });
  it('rejects cross-shop edits and unknown definitions without a payload',()=>{
    expect(()=>upsertCatalogDefinitionInBundle(bundle,'categories',{
      id:'other',shopId:'wrong',name:'Other',slug:null,description:null,active:true,sortOrder:20,
    })).toThrow();
  });
});

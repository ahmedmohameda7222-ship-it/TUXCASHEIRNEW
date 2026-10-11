import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it,vi} from 'vitest';
import {ProductEditor} from './ProductEditor';

const product={
  id:'product',shopId:'shop',categoryId:'cat',slug:'product',name:'Burger',description:null,
  priceMinor:1200,imageKey:null,family:null,bestSeller:false,active:true,soldOut:false,
  isCombo:false,sortOrder:20,
};

describe('catalog product category and combo completeness',()=>{
  it('offers category reassignment, combo toggle and touch-friendly sorting',()=>{
    const html=renderToStaticMarkup(<ProductEditor product={product} canEdit canPrice
      categories={[{id:'cat',shopId:'shop',slug:null,name:'Burgers',description:null,active:true,sortOrder:1},
                   {id:'side',shopId:'shop',slug:null,name:'Sides',description:null,active:true,sortOrder:2}]}
      onSaveDraft={vi.fn()} onSetAvailability={vi.fn()}/>);
    expect(html).toContain('Product category');
    expect(html).toContain('Sides');
    expect(html).toContain('Combo product');
    expect(html).toContain('Sort order');
  });
});

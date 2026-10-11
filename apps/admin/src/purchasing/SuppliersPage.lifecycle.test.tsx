import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it,vi} from 'vitest';
import {SuppliersPage} from './SuppliersPage';

const suppliers=[{id:'supplier-id',businessId:'business-id',name:'Bakery',
  contactName:'Contact',phone:'0123',email:'x@example.com',active:true,version:2}];

describe('supplier management',()=>{
  it('exposes edit and archive actions to authorized business administrators',()=>{
    const html=renderToStaticMarkup(<SuppliersPage
      suppliers={suppliers} canManage canManageLifecycle pending={false}
      onCreate={vi.fn()} onManage={vi.fn()}/>);
    expect(html).toContain('Edit Bakery');
    expect(html).toContain('Archive Bakery');
  });
  it('keeps supplier lifecycle controls hidden from unauthorized roles',()=>{
    const html=renderToStaticMarkup(<SuppliersPage
      suppliers={suppliers} canManage canManageLifecycle={false} pending={false}
      onCreate={vi.fn()} onManage={vi.fn()}/>);
    expect(html).not.toContain('Archive Bakery');
    expect(html).not.toContain('Edit Bakery');
  });
});

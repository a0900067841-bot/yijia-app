drop function if exists public.app_build_anybuy_price_snapshot(jsonb,integer);

create function public.app_build_anybuy_price_snapshot(p_product jsonb,p_groups integer default 1)
returns jsonb
language plpgsql
immutable
set search_path=public
as $$
declare
  g integer:=greatest(1,coalesce(p_groups,1));
  q numeric:=greatest(1,coalesce(nullif(p_product->>'quantity','')::numeric,nullif(p_product->>'bundleQuantity','')::numeric,1));
  op numeric:=greatest(0,coalesce(nullif(p_product->>'originalPrice','')::numeric,nullif(p_product->>'originalBundlePrice','')::numeric,0));
  sp numeric:=greatest(0,coalesce(nullif(p_product->>'price','')::numeric,nullif(p_product->>'salePrice','')::numeric,nullif(p_product->>'bundlePrice','')::numeric,0));
begin
  return p_product||jsonb_build_object(
    'cartQuantity',g,'bundleQuantity',q,'originalBundlePrice',op,'bundlePrice',sp,
    'salePrice',sp,'paidAmount',sp*g,'totalQuantity',q*g,
    'originalUnitPrice',case when q>0 then op/q else 0 end,
    'purchaseSnapshot',jsonb_build_object(
      'originalBundlePrice',op,'saleBundlePrice',sp,'bundleQuantity',q,
      'purchasedGroups',g,'paidAmount',sp*g,
      'originalUnitPrice',case when q>0 then op/q else 0 end
    )
  );
end;
$$;

grant execute on function public.app_build_anybuy_price_snapshot(jsonb,integer) to authenticated;
notify pgrst,'reload schema';

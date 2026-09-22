import React,{Children,cloneElement,isValidElement,type ReactNode,type ReactElement,type TableHTMLAttributes} from 'react';
interface NodeProps {children?:ReactNode;colSpan?:number;className?:string;[key:string]:unknown}
function nodes(children:ReactNode):ReactElement<NodeProps>[] {
  const result:ReactElement<NodeProps>[]=[];
  Children.forEach(children,child=>{if(!isValidElement<NodeProps>(child))return;if(child.type===React.Fragment)result.push(...nodes(child.props.children));else result.push(child);});
  return result;
}
function textOf(node:ReactNode):string {
  if(typeof node==='string'||typeof node==='number')return String(node);
  if(Array.isArray(node))return node.map(textOf).join(' ');
  return isValidElement<NodeProps>(node)?textOf(node.props.children):'';
}
/** One table, one set of actions. Mobile labels are derived from the actual visible column headers. */
export function ResponsiveTable({children,className='',...props}:TableHTMLAttributes<HTMLTableElement>){
  const sections=nodes(children),headers:string[]=[];
  for(const section of sections)if(section.type==='thead')for(const row of nodes(section.props.children))for(const th of nodes(row.props.children))headers.push(textOf(th.props.children).trim()||'Aksi');
  const enhanced=sections.map((section,sectionIndex)=>{
    if(!['thead','tbody','tfoot'].includes(String(section.type)))return section;
    return cloneElement(section,{key:section.key??`section-${sectionIndex}`},nodes(section.props.children).map((row,rowIndex)=>{
      if(row.type!=='tr')return row;
      let index=0;
      const cells=nodes(row.props.children).map(cell=>{
        const label=headers[index]||'Aksi',span=Number(cell.props.colSpan||1);index+=span;
        if(cell.type==='th')return cloneElement(cell,{scope:'col',key:cell.key??`column-${index}`});
        if(cell.type!=='td')return cell;
        const wide=span>1||/aksi|action|操作|catatan|备注|alasan|keterangan|email/i.test(label);
        return cloneElement(cell,{key:cell.key??`cell-${index}`,'data-label':span>1?'':label,'data-wide':wide?'true':undefined,'data-message':span>1?'true':undefined});
      });
      return cloneElement(row,{key:row.key??`row-${rowIndex}`},cells);
    }));
  });
  return <table {...props} className={`buymore-responsive-table ${className}`}>{enhanced}</table>;
}

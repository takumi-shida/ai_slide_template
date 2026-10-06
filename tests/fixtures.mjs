export function catalog() {
  const fields = Object.fromEntries(['title','body'].map(k => [k,{tag:`{{${k}}}`,label:k,required:true,max_chars:100,max_lines:3}]));
  return {
    schema_version:'1',manifest:{schema_version:'1',id:'test-pack',version:'0.1.0',use_case:'sales',source:'source/template.pptx',templates:[{id:'overview',purpose:'Describe the decision',slide_index:0,fields}]},
    pack:{id:'test-pack',version:'0.1.0',content_hash:'a'.repeat(64)},release:null
  };
}
export function plan(c=catalog()) {
  return {schema_version:'1',template_pack:c.pack,purpose:'Agree a pilot',slides:[{instance_id:'page-1',template_id:'overview',fields:{title:'Pilot decision',body:'Try a limited pilot.'},evidence:{title:[],body:['brief']},status:{title:'inferred',body:'confirmed'}}],questions:[]};
}

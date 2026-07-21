require('dotenv').config();
const {MongoClient}=require('mongodb');
const {strip}=require('../scrapers/lib.js');
(async()=>{const c=await MongoClient.connect(process.env.MONGODB_URI);
const col=c.db('open-stacks').collection('books');
const bad=await col.find({$or:[{desc:/<span|<div|<a |property=|&lt;|&#/},{title:new RegExp(String.fromCharCode(0xFFFD))},{desc:new RegExp(String.fromCharCode(0xFFFD))}]},{projection:{desc:1,title:1,body:1}}).toArray();
let n=0;
for(const b of bad){
  const set={};
  const cleanT=strip(b.title||'');
  if(cleanT&&cleanT!==b.title)set.title=cleanT;
  let cleanD=strip(b.desc||'');
  if(/dc:title|sioc:|schema:|xsd:dateTime|datatype/.test(cleanD)) cleanD=(b.body||'').replace(/\s+/g,' ').trim().slice(0,300);
  if(cleanD!==b.desc)set.desc=cleanD;
  if(Object.keys(set).length){await col.updateOne({_id:b._id},{$set:set});n++;}
}
console.log('scanned',bad.length,'updated',n);process.exit(0)})().catch(e=>{console.error(e);process.exit(1)});

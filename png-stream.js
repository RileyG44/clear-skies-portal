/* Clear Skies Portal — streaming PNG encoder.

   Map exports used to be one canvas encoded with canvas.toBlob(). A canvas
   is capped by the browser (16.7 MP on iPhone, 16,384 px per side
   everywhere), so the largest exports could not be made at all. This writes
   a PNG a band of rows at a time instead: rows are filtered (Paeth) and fed
   to the platform's own zlib compressor (CompressionStream "deflate"), and
   each compressed piece goes out as an IDAT chunk the moment it exists.
   Nothing ever holds more than one band of pixels, so the image can be far
   larger than any canvas.

   Output is 8-bit RGB (colour type 2): the map has no transparency and
   dropping alpha saves a quarter of the bytes. Dependency-free, so it runs in
   the browser and under Node's test runner alike. */
(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports) module.exports=api;
  root.CSPPngStream=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";

  const CRC_TABLE=(()=>{
    const table=new Uint32Array(256);
    for(let n=0;n<256;n++){
      let c=n;
      for(let k=0;k<8;k++) c=c&1?0xedb88320^(c>>>1):c>>>1;
      table[n]=c>>>0;
    }
    return table;
  })();
  function crc32(parts){
    let c=0xffffffff;
    for(const bytes of parts) for(let i=0;i<bytes.length;i++) c=CRC_TABLE[(c^bytes[i])&0xff]^(c>>>8);
    return (c^0xffffffff)>>>0;
  }
  const ascii=text=>Uint8Array.from(text,ch=>ch.charCodeAt(0));
  function chunk(type,data){
    const head=new Uint8Array(8),tail=new Uint8Array(4),name=ascii(type);
    const view=new DataView(head.buffer);
    view.setUint32(0,data.length);head.set(name,4);
    new DataView(tail.buffer).setUint32(0,crc32([name,data]));
    return [head,data,tail];
  }
  const SIGNATURE=Uint8Array.of(137,80,78,71,13,10,26,10);

  function supported(){ return typeof CompressionStream==="function" }

  /* create({width,height,write}) -> {writeRows(rgba,rows,stride?), finish()}
     write(Uint8Array) receives the file in order; it may return a promise,
     which is awaited (a file on disk applies backpressure that way).
     rgba is RGBA bytes, rows full-width rows; stride is bytes per input row
     (default width*4). */
  function create({width,height,write}){
    if(!(width>0&&height>0&&width<=0x7fffffff&&height<=0x7fffffff)) throw new Error("PNG dimensions out of range");
    if(!supported()) throw new Error("This browser cannot stream-compress images");
    const rowBytes=width*3;
    let prev=new Uint8Array(rowBytes),cur=new Uint8Array(rowBytes),rowsWritten=0,failed=null;
    const stream=new CompressionStream("deflate");
    const input=stream.writable.getWriter();
    let pending=Promise.resolve();
    const emit=parts=>{ pending=pending.then(async()=>{ for(const p of parts) await write(p) }); return pending };

    const ihdr=new Uint8Array(13),hv=new DataView(ihdr.buffer);
    hv.setUint32(0,width);hv.setUint32(4,height);
    ihdr[8]=8;ihdr[9]=2;ihdr[10]=0;ihdr[11]=0;ihdr[12]=0;
    emit([SIGNATURE,...chunk("IHDR",ihdr)]);

    /* Compressed output is regrouped into IDAT chunks of about 1 MB: one
       chunk per tiny piece the compressor yields would waste 12 bytes each and
       slow every reader of the file. */
    const IDAT_TARGET=1<<20;
    const drain=(async()=>{
      const reader=stream.readable.getReader();
      let buf=[],size=0;
      const flush=async()=>{
        if(!size) return;
        const data=new Uint8Array(size);let at=0;
        for(const piece of buf){ data.set(piece,at);at+=piece.length }
        buf=[];size=0;
        await emit(chunk("IDAT",data));
      };
      for(;;){
        const {value,done}=await reader.read();
        if(done) break;
        buf.push(value);size+=value.length;
        if(size>=IDAT_TARGET) await flush();
      }
      await flush();
    })().catch(error=>{ failed=error; throw error });

    async function writeRows(rgba,rows,stride=width*4){
      if(failed) throw failed;
      if(rowsWritten+rows>height) throw new Error("More rows than the image height");
      const line=1+rowBytes,band=new Uint8Array(rows*line);
      for(let r=0;r<rows;r++){
        let i=r*stride;
        for(let j=0;j<rowBytes;j+=3,i+=4){ cur[j]=rgba[i];cur[j+1]=rgba[i+1];cur[j+2]=rgba[i+2] }
        /* Paeth filter (type 4): the best general-purpose predictor for
           photographic imagery, which is most of a map export. The first
           pixel has no left neighbour, so it is split out of the hot loop. */
        const o=r*line;band[o]=4;
        for(let j=0;j<3;j++) band[o+1+j]=(cur[j]-prev[j])&0xff;
        for(let j=3;j<rowBytes;j++){
          const a=cur[j-3],b=prev[j],c=prev[j-3];
          const pa=b>c?b-c:c-b,pb=a>c?a-c:c-a,pc=a+b-c-c,apc=pc<0?-pc:pc;
          band[o+1+j]=(cur[j]-(pa<=pb&&pa<=apc?a:pb<=apc?b:c))&0xff;
        }
        const swap=prev;prev=cur;cur=swap;
      }
      await input.ready;
      await input.write(band);
      rowsWritten+=rows;
    }
    async function finish(){
      if(rowsWritten!==height) throw new Error(`PNG incomplete: ${rowsWritten} of ${height} rows`);
      await input.close();
      await drain;
      await emit(chunk("IEND",new Uint8Array(0)));
      await pending;
    }
    function abort(reason){ try{ input.abort(reason) }catch(e){} }
    return {writeRows,finish,abort};
  }

  return {create,supported,crc32};
});

// 億家 Enterprise - 離線 Code128-B 條碼產生器
// 不依賴外部 CDN，適合 PWA / 離線環境。

const CODE128_PATTERNS = [
"11011001100","11001101100","11001100110","10010011000","10010001100","10001001100",
"10011001000","10011000100","10001100100","11001001000","11001000100","11000100100",
"10110011100","10011011100","10011001110","10111001100","10011101100","10011100110",
"11001110010","11001011100","11001001110","11011100100","11001110100","11101101110",
"11101001100","11100101100","11100100110","11101100100","11100110100","11100110010",
"11011011000","11011000110","11000110110","10100011000","10001011000","10001000110",
"10110001000","10001101000","10001100010","11010001000","11000101000","11000100010",
"10110111000","10110001110","10001101110","10111011000","10111000110","10001110110",
"11101110110","11010001110","11000101110","11011101000","11011100010","11011101110",
"11101011000","11101000110","11100010110","11101101000","11101100010","11100011010",
"11101111010","11001000010","11110001010","10100110000","10100001100","10010110000",
"10010000110","10000101100","10000100110","10110010000","10110000100","10011010000",
"10011000010","10000110100","10000110010","11000010010","11001010000","11110111010",
"11000010100","10001111010","10100111100","10010111100","10010011110","10111100100",
"10011110100","10011110010","11110100100","11110010100","11110010010","11011011110",
"11011110110","11110110110","10101111000","10100011110","10001011110","10111101000",
"10111100010","11110101000","11110100010","10111011110","10111101110","11101011110",
"11110101110","11010000100","11010010000","11010011100","1100011101011"
];

function escapeHtml(v){
 return String(v??"")
  .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
  .replaceAll('"',"&quot;").replaceAll("'","&#039;");
}

export function code128Values(text){
 const s=String(text??"");
 if(!s) throw new Error("條碼內容不可為空");
 const values=[104]; // Start B
 for(const ch of s){
  const n=ch.charCodeAt(0);
  if(n<32||n>126) throw new Error("Code128-B 僅支援 ASCII 32–126");
  values.push(n-32);
 }
 let checksum=104;
 for(let i=1;i<values.length;i++) checksum+=values[i]*i;
 checksum%=103;
 return [...values,checksum,106];
}


export function code128Bits(text){
 const values=code128Values(text);
 return values.map(v=>CODE128_PATTERNS[v]).join("");
}

export function code128Svg(text, opts={}){
 const height=Number(opts.height||58);
 const moduleWidth=Number(opts.moduleWidth||1.7);
 const quiet=Number(opts.quiet||10);
 const showText=opts.showText!==false;
 const values=code128Values(text);
 const bits=values.map(v=>CODE128_PATTERNS[v]).join("");
 const width=(bits.length+quiet*2)*moduleWidth;
 let rects="";
 let i=0;
 while(i<bits.length){
  if(bits[i]==="1"){
   let j=i;
   while(j<bits.length&&bits[j]==="1")j++;
   const x=(quiet+i)*moduleWidth;
   const w=(j-i)*moduleWidth;
   rects+=`<rect x="${x}" y="0" width="${w}" height="${height}" fill="#000"/>`;
   i=j;
  }else i++;
 }
 const textH=showText?18:0;
 return `<svg class="auto-code128" xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height+textH}" viewBox="0 0 ${width} ${height+textH}" role="img" aria-label="Barcode ${escapeHtml(text)}">
  <rect width="100%" height="100%" fill="#fff"/>
  ${rects}
  ${showText?`<text x="${width/2}" y="${height+14}" text-anchor="middle" font-family="monospace" font-size="12" fill="#000">${escapeHtml(text)}</text>`:""}
 </svg>`;
}

export function systemBarcode(prefix="YJ"){
 const ts=Date.now().toString(36).toUpperCase();
 const rand=Math.random().toString(36).slice(2,7).toUpperCase();
 return `${prefix}${ts}${rand}`;
}

export function ensureBarcode(value,prefix="YJ"){
 return String(value||"").trim() || systemBarcode(prefix);
}

export function numericProductBarcode(){
 const ts=String(Date.now()).slice(-10);
 const rand=String(Math.floor(Math.random()*1000)).padStart(3,'0');
 return `${ts}${rand}`.slice(0,13);
}

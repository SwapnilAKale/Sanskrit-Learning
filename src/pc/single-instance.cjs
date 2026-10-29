'use strict';
const crypto=require('node:crypto');
function acquire(root){const k=require('koffi'),dll=k.load('kernel32.dll'),create=dll.func('void * __stdcall CreateMutexW(void *attributes, int owner, str16 name)'),error=dll.func('uint32 __stdcall GetLastError()'),close=dll.func('int __stdcall CloseHandle(void *handle)');
 const name='Local\\SanskritLearningPc-'+crypto.createHash('sha256').update(root.toLowerCase()).digest('hex');const handle=create(null,0,name);const code=error();if(!handle)throw Error('Could not reserve PC voice service.');if(code===183){close(handle);return null;}return ()=>close(handle);
}
module.exports={acquire};

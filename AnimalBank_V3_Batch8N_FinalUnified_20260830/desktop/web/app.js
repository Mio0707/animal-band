const { invoke } = window.__TAURI__.core;
const { open } = window.__TAURI__.dialog;
const list = document.querySelector("[data-course-list]");
const importButton = document.querySelector("[data-import-course]");
const deleteDialog = document.querySelector("[data-confirm-delete]");

function escapeHtml(value){return String(value??"").replace(/[&<>'"]/g,(char)=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[char]));}
function showStatus(message){document.querySelector(".status")?.remove();const node=document.createElement("div");node.className="status";node.textContent=message;document.body.append(node);setTimeout(()=>node.remove(),3200);}
function formatSize(value){const size=Number(value)||0;return size>1024*1024?`${(size/1024/1024).toFixed(1)} MB`:`${Math.ceil(size/1024)} KB`;}

async function refresh(){
  const courses=await invoke("list_courses");
  list.innerHTML=courses.length?courses.map((course)=>`<article class="course-card"><small>已下载 · 可离线使用</small><h2>《${escapeHtml(course.title)}》</h2><p>${escapeHtml(course.file_count)} 个资源 · ${formatSize(course.total_bytes)}</p><div class="course-actions"><button class="start" data-start="${escapeHtml(course.pack_id)}">开始上课</button><button class="delete" data-delete="${escapeHtml(course.pack_id)}">删除</button></div></article>`).join(""):`<div class="empty"><strong>还没有离线课程</strong><span>从网页下载课程，或点击右上角导入 `.animalclass` 文件。</span></div>`;
}

async function importPath(path){
  if(!path)return;
  importButton.disabled=true;importButton.textContent="正在校验课包…";
  try{const course=await invoke("import_course",{path});showStatus(`《${course.title}》已保存到本地`);await refresh();}
  catch(error){showStatus(`导入失败：${error}`);}
  finally{importButton.disabled=false;importButton.textContent="＋ 导入离线课";}
}

importButton.addEventListener("click",async()=>importPath(await open({multiple:false,filters:[{name:"动物乐队离线课",extensions:["animalclass"]}]})));
list.addEventListener("click",async(event)=>{
  const start=event.target.closest("[data-start]");
  if(start){start.disabled=true;start.textContent="正在启动…";try{await invoke("start_course",{packId:start.dataset.start});showStatus("课堂已在新窗口打开");}catch(error){showStatus(`启动失败：${error}`);}finally{start.disabled=false;start.textContent="开始上课";}return;}
  const remove=event.target.closest("[data-delete]");
  if(remove){deleteDialog.showModal();if(await new Promise((resolve)=>deleteDialog.addEventListener("close",()=>resolve(deleteDialog.returnValue==="confirm"),{once:true}))){await invoke("delete_course",{packId:remove.dataset.delete});await refresh();}}
});

window.__TAURI__.event.listen("course-file-opened",({payload})=>importPath(payload));
invoke("initial_course_file").then(importPath).catch(()=>{});
refresh().catch((error)=>showStatus(`课程列表读取失败：${error}`));

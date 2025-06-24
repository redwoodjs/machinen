import { requestInfo } from "rwsdk/worker";
import { Editor } from "./Editor";
import { FileBrowser } from "./FileBrowser";
import { fileType, getFile } from "./functions";
import { Preview } from "./Preview";

export const EditorPage = async () => {
  const url = new URL(requestInfo.request.url);
  let pathname = url.pathname;
  if (url.pathname.startsWith("/editor")) {
    pathname = pathname.split("/editor")[1];
    if (pathname.length === 0) {
      pathname = "/";
    }
  }

  const type = await fileType(pathname);
  let content = "";
  if (type == "file") {
    const file = await getFile(pathname);
    content = file.content;
  }

  return (
    <div className="h-screen flex overflow-hidden">
      <div className="h-screen resize-x min-w-[180px] overflow-auto border-r-4 p-2">
        <FileBrowser pathname={pathname} />
      </div>
      <div className="h-screen min-w-[600px] resize-x border-r-4 overflow-auto p-2">
        <Editor pathname={pathname} initialContent={content} key={pathname} />
      </div>
      <div className="h-screen p-2 flex flex-1">
        <Preview />
      </div>
    </div>
  );
};

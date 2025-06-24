import { requestInfo } from "rwsdk/worker";
import { Editor } from "./Editor";
import { FileBrowser } from "./FileBrowser";
import { fileType, getFile } from "./functions";

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
    <div className="h-full">
      <div className="flex h-full">
        <div className="h-full resize-x min-w-[180px] overflow-auto border-r p-2">
          <FileBrowser pathname={pathname} />
        </div>
        <div className="h-full min-w-[600px] resize-x border-r overflow-auto">
          <Editor key={pathname} pathname={pathname} initialContent={content} />
        </div>
        <div className="h-full">
          <iframe src="/" className="h-full" />
        </div>
      </div>
    </div>
  );
};

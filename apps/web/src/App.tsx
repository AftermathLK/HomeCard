import { useEffect } from 'react';
import { Toasts } from '@/components/ui';
import { EditorScreen } from '@/editor/EditorScreen';
import { ExportModal } from '@/export/ExportModal';
import { NewCardModal, ProjectsHome } from '@/home/ProjectsHome';
import { useAssets } from '@/lib/assets';
import { PhotoPicker } from '@/picker/PhotoPicker';
import { SettingsModal } from '@/settings/SettingsModal';
import { useEditor } from '@/store/editor';
import { useHolidays } from '@/store/holidays';
import { useSession } from '@/store/session';
import { useUi } from '@/store/ui';

export function App() {
  const route = useUi((s) => s.route);
  const user = useSession((s) => s.user);

  // Who is signed in decides everything else; a signed-out browser is sent to /login.
  useEffect(() => {
    useSession
      .getState()
      .load()
      .then((u) => {
        if (!u || u.mustChangePassword) return;
        void useHolidays.getState().load();
        return useAssets.getState().init();
      })
      .catch((err) => useUi.getState().toast(`Couldn’t reach the HomeCard server: ${err.message}`, 'error'));
  }, []);

  // Leaving the editor: flush the autosave and drop the in-memory project + history.
  useEffect(() => {
    if (route.name === 'home' && useEditor.getState().project) useEditor.getState().close();
  }, [route]);

  useEffect(() => {
    document.title = route.name === 'editor' ? `${useEditor.getState().project?.name ?? 'Card'} · HomeCard` : 'HomeCard';
    return useEditor.subscribe((s, prev) => {
      if (s.project?.name !== prev.project?.name && useUi.getState().route.name === 'editor') document.title = `${s.project?.name ?? 'Card'} · HomeCard`;
    });
  }, [route]);

  if (!user || user.mustChangePassword) {
    return (
      <div className="flex h-full items-center justify-center text-ink-3">
        Loading…
        <Toasts />
      </div>
    );
  }

  return (
    <>
      {route.name === 'home' ? <ProjectsHome /> : <EditorScreen key={route.projectId} projectId={route.projectId} />}
      <NewCardModal />
      <PhotoPicker />
      <ExportModal />
      <SettingsModal />
      <Toasts />
    </>
  );
}

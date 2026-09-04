import React, { useState } from 'react';
import {
  FiFolder,
  FiPlus,
  FiRefreshCw,
  FiTrash2,
  FiAlertTriangle,
  FiCheckCircle,
  FiFilm,
  FiTv,
  FiHelpCircle,
  FiFolderPlus,
  FiChevronDown,
  FiChevronUp,
} from 'react-icons/fi';
import { toast } from 'react-hot-toast';
import {
  useLocalMediaFolders,
  useValidateLocalPath,
  usePrepareFolderStructure,
  useSaveLocalFolder,
  useDeleteLocalFolder,
  useScanLocalMedia,
  type FolderScanPreview,
} from '../../api/localMedia';

export const LocalFoldersTab: React.FC = () => {
  const { data: folders = [], isLoading } = useLocalMediaFolders();
  const validateMutation = useValidateLocalPath();
  const prepareMutation = usePrepareFolderStructure();
  const saveMutation = useSaveLocalFolder();
  const deleteMutation = useDeleteLocalFolder();
  const scanMutation = useScanLocalMedia();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [folderPath, setFolderPath] = useState('');
  const [folderName, setFolderName] = useState('');
  const [folderCategory, setFolderCategory] = useState('Mídia Local');
  const [preview, setPreview] = useState<FolderScanPreview | null>(null);
  const [showGuide, setShowGuide] = useState(false);

  const handleOpenAddModal = () => {
    setFolderPath('');
    setFolderName('');
    setFolderCategory('Mídia Local');
    setPreview(null);
    setIsModalOpen(true);
  };

  const handleValidate = async () => {
    if (!folderPath.trim()) {
      toast.error('Informe o caminho da pasta.');
      return;
    }
    try {
      const res = await validateMutation.mutateAsync(folderPath.trim());
      setPreview(res);
      if (!folderName) {
        // Auto-generate a friendly name from folder basename
        const cleanBase = folderPath.trim().replace(/[\\/]+$/, '').split(/[\\/]/).pop();
        setFolderName(cleanBase || 'Pasta de Mídia');
      }
      if (res.exists) {
        toast.success(`Pasta analisada! ${res.videoFilesCount} vídeos detectados.`);
      } else {
        toast.error('A pasta não existe no servidor. Você pode clicar em "Preparar Estrutura" para criá-la.');
      }
    } catch (err) {
      toast.error((err as Error).message || 'Erro ao analisar pasta');
    }
  };

  const handlePrepare = async () => {
    if (!folderPath.trim()) {
      toast.error('Informe o caminho da pasta primeiro.');
      return;
    }
    try {
      const res = await prepareMutation.mutateAsync(folderPath.trim());
      if (res.success) {
        toast.success(res.message);
        // Re-validate to show updated folder status
        handleValidate();
      } else {
        toast.error(res.message);
      }
    } catch (err) {
      toast.error((err as Error).message || 'Erro ao preparar estrutura');
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!folderPath.trim() || !folderName.trim()) {
      toast.error('Preencha o nome e o caminho da pasta.');
      return;
    }

    try {
      await saveMutation.mutateAsync({
        name: folderName.trim(),
        path: folderPath.trim(),
        category: folderCategory.trim() || 'Mídia Local',
        isActive: true,
      });
      toast.success('Pasta local adicionada e indexada com sucesso!');
      setIsModalOpen(false);
    } catch (err) {
      toast.error((err as Error).message || 'Erro ao salvar pasta');
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`Deseja remover a pasta "${name}" da biblioteca? Seus arquivos em disco não serão deletados.`)) {
      return;
    }
    try {
      await deleteMutation.mutateAsync(id);
      toast.success('Pasta removida da biblioteca!');
    } catch (err) {
      toast.error((err as Error).message || 'Erro ao remover pasta');
    }
  };

  const handleScanAll = async () => {
    try {
      const res = await scanMutation.mutateAsync();
      toast.success(
        `Biblioteca atualizada: ${res.moviesCount} filmes e ${res.seriesCount} séries (${res.episodesCount} episódios)!`
      );
    } catch (err) {
      toast.error((err as Error).message || 'Erro ao escanear pastas');
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header Banner */}
      <div className="bg-gray-800/80 border border-gray-700/80 rounded-2xl p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-primary-600/20 text-primary-400 border border-primary-500/30">
              <FiFolder className="w-5 h-5" />
            </div>
            <h2 className="text-xl font-bold text-white">Pastas Locais de Vídeo</h2>
          </div>
          <p className="text-sm text-gray-400 mt-2 max-w-2xl leading-relaxed">
            Adicione pastas de vídeos do seu computador ou servidor para integrá-las automaticamente ao catálogo VOD
            (filmes e séries). O streaming conta com suporte nativo a HTTP Range (206) e Cast para a TV sem travar.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={handleScanAll}
            disabled={scanMutation.isPending || folders.length === 0}
            className="px-4 py-2.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white text-sm font-semibold rounded-xl flex items-center gap-2 transition-all shadow-sm active:scale-95"
          >
            <FiRefreshCw className={`w-4 h-4 ${scanMutation.isPending ? 'animate-spin' : ''}`} />
            <span>{scanMutation.isPending ? 'Escaneando...' : 'Escanear Todas'}</span>
          </button>

          <button
            type="button"
            onClick={handleOpenAddModal}
            className="px-4 py-2.5 bg-primary-600 hover:bg-primary-500 text-white text-sm font-semibold rounded-xl flex items-center gap-2 transition-all shadow-lg shadow-primary-600/25 active:scale-95"
          >
            <FiPlus className="w-4 h-4" />
            <span>Adicionar Pasta Local</span>
          </button>
        </div>
      </div>

      {/* Guide Accordion */}
      <div className="bg-neutral-900/60 border border-neutral-800 rounded-2xl overflow-hidden transition-all">
        <button
          type="button"
          onClick={() => setShowGuide(!showGuide)}
          className="w-full px-5 py-3.5 flex items-center justify-between text-left text-sm font-semibold text-neutral-300 hover:text-white transition-colors"
        >
          <span className="flex items-center gap-2">
            <FiHelpCircle className="w-4 h-4 text-primary-400" />
            <span>Como organizar seus vídeos para o ViniPlay identificar tudo com perfeição?</span>
          </span>
          {showGuide ? <FiChevronUp className="w-4 h-4" /> : <FiChevronDown className="w-4 h-4" />}
        </button>

        {showGuide && (
          <div className="p-5 border-t border-neutral-800 text-xs sm:text-sm text-neutral-300 space-y-4 bg-neutral-950/40">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 rounded-xl bg-neutral-900 border border-neutral-800 space-y-2">
                <div className="flex items-center gap-2 font-bold text-amber-300">
                  <FiFilm className="w-4 h-4" />
                  <span>Organização de Filmes</span>
                </div>
                <p className="text-neutral-400">
                  Coloque filmes na pasta <code className="text-primary-300 font-mono">Filmes/Categoria/</code>.
                </p>
                <div className="bg-neutral-950 p-3 rounded-lg font-mono text-xs text-neutral-300 space-y-1">
                  <div>📁 Filmes/</div>
                  <div className="pl-4">📁 Ação/</div>
                  <div className="pl-8 text-emerald-400">🎬 John Wick (2014).mp4</div>
                  <div className="pl-4">📁 Ficção Científica/</div>
                  <div className="pl-8 text-emerald-400">🎬 Matrix (1999).mkv</div>
                  <div className="pl-8 text-neutral-500">🖼️ poster.jpg (capa opcional)</div>
                </div>
                <p className="text-neutral-400 text-xs">
                  • O ano entre parênteses <code className="text-primary-300">(2024)</code> é identificado automaticamente.
                  <br />• Imagens <code className="text-primary-300">poster.jpg</code> viram capas no catálogo!
                </p>
              </div>

              <div className="p-4 rounded-xl bg-neutral-900 border border-neutral-800 space-y-2">
                <div className="flex items-center gap-2 font-bold text-blue-300">
                  <FiTv className="w-4 h-4" />
                  <span>Organização de Séries</span>
                </div>
                <p className="text-neutral-400">
                  Coloque na pasta <code className="text-primary-300 font-mono">Series/Categoria/Nome da Série/Temporada/</code>.
                </p>
                <div className="bg-neutral-950 p-3 rounded-lg font-mono text-xs text-neutral-300 space-y-1">
                  <div>📁 Series/</div>
                  <div className="pl-4">📁 Drama/</div>
                  <div className="pl-8">📁 Breaking Bad/</div>
                  <div className="pl-12 text-neutral-500">🖼️ poster.jpg (capa da série)</div>
                  <div className="pl-12">📁 Season 01/</div>
                  <div className="pl-16 text-emerald-400">📺 Breaking Bad - S01E01.mp4</div>
                  <div className="pl-16 text-emerald-400">📺 Breaking Bad - S01E02.mp4</div>
                </div>
                <p className="text-neutral-400 text-xs">
                  • Use os padrões <code className="text-primary-300">S01E01</code> ou <code className="text-primary-300">1x01</code> para ordenar as temporadas e episódios perfeitamente.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Folders List */}
      {isLoading ? (
        <div className="py-12 text-center text-neutral-400">Carregando pastas...</div>
      ) : folders.length === 0 ? (
        <div className="bg-neutral-900/40 border border-neutral-800 rounded-2xl p-12 text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-neutral-800/80 text-neutral-500 flex items-center justify-center mx-auto">
            <FiFolder className="w-8 h-8" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">Nenhuma pasta local cadastrada</h3>
            <p className="text-sm text-neutral-400 max-w-md mx-auto mt-1">
              Cadastre uma pasta do seu computador para adicionar filmes e séries pessoais ao catálogo VOD.
            </p>
          </div>
          <button
            type="button"
            onClick={handleOpenAddModal}
            className="px-4 py-2 bg-primary-600 hover:bg-primary-500 text-white text-sm font-semibold rounded-xl inline-flex items-center gap-2 transition-all shadow-md active:scale-95"
          >
            <FiPlus className="w-4 h-4" />
            <span>Adicionar Minha Primeira Pasta</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {folders.map((folder) => (
            <div
              key={folder.id}
              className="bg-neutral-900/90 border border-neutral-800 hover:border-neutral-700 rounded-2xl p-5 space-y-4 shadow-lg transition-all"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-primary-600/10 text-primary-400 border border-primary-500/20">
                    <FiFolder className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-white text-base">{folder.name}</h3>
                    <span className="text-xs px-2 py-0.5 rounded font-medium bg-neutral-800 text-neutral-400 border border-neutral-700/50">
                      {folder.category || 'Mídia Local'}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handleDelete(folder.id, folder.name)}
                  className="p-2 text-neutral-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-xl transition-colors"
                  title="Remover pasta da biblioteca"
                >
                  <FiTrash2 className="w-4 h-4" />
                </button>
              </div>

              <div className="bg-neutral-950/80 p-2.5 rounded-xl border border-neutral-800/80 font-mono text-xs text-neutral-300 truncate">
                {folder.path}
              </div>

              <div className="flex items-center justify-between pt-1 text-xs text-neutral-400">
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1 text-amber-400 font-semibold">
                    <FiFilm className="w-3.5 h-3.5" />
                    {folder.itemCount?.movies ?? 0} filmes
                  </span>
                  <span className="flex items-center gap-1 text-blue-400 font-semibold">
                    <FiTv className="w-3.5 h-3.5" />
                    {folder.itemCount?.series ?? 0} séries ({folder.itemCount?.episodes ?? 0} eps)
                  </span>
                </div>

                {folder.lastScanned && (
                  <span className="text-[11px] text-neutral-500">
                    Scan: {new Date(folder.lastScanned).toLocaleDateString()}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add / Setup Folder Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in">
          <div className="relative w-full max-w-xl bg-neutral-900 border border-neutral-800 rounded-3xl p-6 max-h-[90vh] overflow-y-auto shadow-2xl space-y-6">
            <div className="flex items-center justify-between pb-3 border-b border-neutral-800">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-primary-600/20 text-primary-400">
                  <FiFolder className="w-5 h-5" />
                </div>
                <h3 className="text-lg font-bold text-white">Adicionar Pasta Local de Vídeos</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="p-1 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-4">
              {/* Path input and analyze button */}
              <div>
                <label className="block text-xs font-semibold text-neutral-300 mb-1.5">
                  Caminho Absoluto da Pasta no Servidor / PC:
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={folderPath}
                    onChange={(e) => setFolderPath(e.target.value)}
                    placeholder="/home/usuario/Videos ou D:\Videos"
                    className="flex-1 bg-neutral-950 border border-neutral-800 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-primary-500 font-mono"
                    required
                  />
                  <button
                    type="button"
                    onClick={handleValidate}
                    disabled={validateMutation.isPending || !folderPath.trim()}
                    className="px-4 py-2.5 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 text-white text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-all"
                  >
                    <FiRefreshCw className={`w-3.5 h-3.5 ${validateMutation.isPending ? 'animate-spin' : ''}`} />
                    <span>Analisar</span>
                  </button>
                </div>
                <p className="text-[11px] text-neutral-500 mt-1">
                  Exemplo no Linux: <code className="text-neutral-400">/home/usuario/Videos</code> | No Windows:{' '}
                  <code className="text-neutral-400">C:\Videos</code>
                </p>
              </div>

              {/* Scaffolding Button (If folder does not exist or user wants automatic layout) */}
              <div className="p-3.5 rounded-2xl bg-primary-950/30 border border-primary-500/20 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <span className="text-xs font-bold text-primary-300 flex items-center gap-1.5">
                    <FiFolderPlus className="w-4 h-4" />
                    Preparar Estrutura Recomendada
                  </span>
                  <p className="text-[11px] text-neutral-400">
                    Cria automaticamente as pastas <code>Filmes/Ação/</code>, <code>Series/Geral/</code> e o arquivo de instruções no disco.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handlePrepare}
                  disabled={prepareMutation.isPending || !folderPath.trim()}
                  className="px-3 py-1.5 bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white text-xs font-semibold rounded-xl shrink-0 transition-all shadow-sm"
                >
                  {prepareMutation.isPending ? 'Criando...' : 'Criar Estrutura'}
                </button>
              </div>

              {/* Scan Preview Diagnostic Card */}
              {preview && (
                <div
                  className={`p-4 rounded-2xl border text-xs space-y-3 ${
                    preview.isValid && preview.videoFilesCount > 0
                      ? 'bg-emerald-950/20 border-emerald-500/30'
                      : preview.isValid
                        ? 'bg-amber-950/20 border-amber-500/30'
                        : 'bg-rose-950/20 border-rose-500/30'
                  }`}
                >
                  <div className="flex items-center gap-2 font-bold text-sm">
                    {preview.isValid && preview.videoFilesCount > 0 ? (
                      <>
                        <FiCheckCircle className="w-4 h-4 text-emerald-400" />
                        <span className="text-emerald-300">
                          Diagnóstico: Pasta Pronta ({preview.videoFilesCount} vídeos encontrados)
                        </span>
                      </>
                    ) : preview.isValid ? (
                      <>
                        <FiAlertTriangle className="w-4 h-4 text-amber-400" />
                        <span className="text-amber-300">Diagnóstico: Pasta vazia ou sem vídeos</span>
                      </>
                    ) : (
                      <>
                        <FiAlertTriangle className="w-4 h-4 text-rose-400" />
                        <span className="text-rose-300">Diagnóstico: Caminho Inválido</span>
                      </>
                    )}
                  </div>

                  {preview.isValid && (
                    <div className="grid grid-cols-2 gap-2 text-neutral-300">
                      <div className="bg-neutral-900/80 p-2.5 rounded-xl">
                        <span className="text-neutral-400 block text-[10px] uppercase font-bold">Filmes Identificados</span>
                        <span className="text-base font-bold text-amber-300">{preview.moviesFound.length}</span>
                      </div>
                      <div className="bg-neutral-900/80 p-2.5 rounded-xl">
                        <span className="text-neutral-400 block text-[10px] uppercase font-bold">Séries Identificadas</span>
                        <span className="text-base font-bold text-blue-300">{preview.seriesFound.length}</span>
                      </div>
                    </div>
                  )}

                  {/* Warnings */}
                  {preview.warnings.length > 0 && (
                    <div className="space-y-1">
                      <span className="font-semibold text-neutral-300">Avisos de Melhoria:</span>
                      <ul className="list-disc pl-4 space-y-0.5 text-neutral-400 text-[11px]">
                        {preview.warnings.map((w, idx) => (
                          <li key={idx}>{w}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* Name & Category fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                <div>
                  <label className="block text-xs font-semibold text-neutral-300 mb-1.5">Nome da Pasta:</label>
                  <input
                    type="text"
                    value={folderName}
                    onChange={(e) => setFolderName(e.target.value)}
                    placeholder="Ex: Meus Filmes & Séries"
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-primary-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-neutral-300 mb-1.5">Categoria Padrão no VOD:</label>
                  <input
                    type="text"
                    value={folderCategory}
                    onChange={(e) => setFolderCategory(e.target.value)}
                    placeholder="Ex: Mídia Local"
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-primary-500"
                  />
                </div>
              </div>

              {/* Modal Actions */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-neutral-800">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-neutral-400 hover:text-white hover:bg-neutral-800 rounded-xl transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saveMutation.isPending || !folderPath.trim() || !folderName.trim()}
                  className="px-5 py-2.5 bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition-all shadow-lg shadow-primary-600/30 active:scale-95"
                >
                  {saveMutation.isPending ? 'Salvando e Escaneando...' : 'Salvar e Indexar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

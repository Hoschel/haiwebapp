import React, { useEffect } from 'react'
import { useAppContext } from '../context/AppContext'
import PromptInput from '../components/PromptInput'
import { homeTags } from '../assets/assets'
import { useNavigate } from 'react-router-dom'
import {
  ArrowRightIcon,
  ClockIcon,
  Trash2Icon,
} from 'lucide-react'
import moment from 'moment'

const HomePage = () => {
  const navigate = useNavigate()

  const {
    user,
    projects = [],
    loadingProjects,
    generatingProject,
    loadProjects,
    handleGenerate,
    handleDelete,
    logout,
  } = useAppContext()

  useEffect(() => {
    loadProjects()
  }, [loadProjects])

  const handleProjectDelete = async (event, projectId) => {
    event.stopPropagation()

    try {
      await handleDelete(projectId)
    } catch (error) {
      console.error('Failed to delete project:', error)
    }
  }

  return (
    <div className="min-h-screen overflow-y-auto bg-[url('/bg-img.png')] bg-cover bg-center bg-no-repeat text-white font-sans">
      {/* Navigation */}
      <nav className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <img
            src="/logo.svg"
            alt="HAI Builder Logo"
            className="h-6 w-6"
          />

          <span className="text-xl font-semibold tracking-tight">
            HAI Builder
          </span>
        </div>

        <div className="flex items-center gap-4 text-sm font-medium text-zinc-300">
          <span>{user?.name || 'Guest'}</span>

          <button
            type="button"
            onClick={logout}
            className="cursor-pointer rounded-md border border-white/20 bg-transparent px-3 py-1.5 text-xs text-white transition hover:bg-white/10"
          >
            Sign Out
          </button>
        </div>
      </nav>

      {/* Hero */}
      <main className="flex flex-col items-center px-6 pb-20 pt-8 xl:pt-28">
        <div className="flex w-full max-w-2xl flex-col items-center">
          {/* Promo Badge */}
          <div className="flex items-center gap-2 rounded-full border border-white/20 bg-white/10 p-1.5 pr-3 text-[13px] text-white/90 backdrop-blur-md">
            <span className="rounded-full bg-red-700 px-3 py-1 text-[11px] font-medium tracking-wider">
              PROMO
            </span>

            <span>
              Create your first AI-powered website in minutes for free!
            </span>
          </div>

          {/* Title */}
          <h1 className="mt-4 max-w-2xl text-center text-4xl font-medium text-white md:text-6xl">
            Let's build your web app together
          </h1>

          <p className="mt-4 max-w-xl text-center text-sm leading-relaxed text-white/65 md:text-base">
            Describe your idea and watch HAI Builder's magic, structure and
            launch your website instantly. No coding skills required, just
            your imagination and creativity. Start building your online
            presence today!
          </p>

          {/* Prompt Input */}
          <div className="mt-6 w-full">
            <PromptInput
              onSubmit={handleGenerate}
              loading={generatingProject}
              placeholder="Create a portfolio website..."
              variant="glass"
              autoFocus
            />
          </div>

          {/* Scrolling Marquee Tags */}
          {homeTags?.length > 0 && (
            <div className="masked-marquee mt-4 w-full max-w-2xl overflow-hidden py-1">
              <div className="animate-marquee flex gap-3">
                {homeTags.map((tag, index) => (
                  <button
                    key={`${tag}-${index}`}
                    type="button"
                    onClick={() => handleGenerate(tag)}
                    disabled={generatingProject}
                    className="shrink-0 cursor-pointer rounded-full border border-white/25 bg-white/10 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Loading Projects */}
          {loadingProjects && (
            <div className="mt-12 w-full">
              <div className="flex items-center justify-center py-8 text-sm text-white/50">
                Loading projects...
              </div>
            </div>
          )}

          {/* All Projects */}
          {!loadingProjects && projects.length > 0 && (
            <section className="mt-12 w-full">
              <div className="mb-3 flex items-center justify-between border-b border-white/10 pb-3">
                <p className="text-xs font-medium uppercase tracking-widest text-zinc-100">
                  All Projects
                </p>

                <span className="text-xs font-normal text-zinc-100">
                  {projects.length}{' '}
                  {projects.length === 1 ? 'project' : 'projects'}
                </span>
              </div>

              <div className="space-y-2">
                {projects.map((project) => {
                  const updatedAt =
                    project.updatedAt ||
                    project.updateAt ||
                    project.createdAt

                  return (
                    <div
                      key={project._id}
                      role="button"
                      tabIndex={0}
                      onClick={() =>
                        navigate(`/builder/${project._id}`)
                      }
                      onKeyDown={(event) => {
                        if (
                          event.key === 'Enter' ||
                          event.key === ' '
                        ) {
                          event.preventDefault()
                          navigate(`/builder/${project._id}`)
                        }
                      }}
                      className="group flex cursor-pointer items-center justify-between rounded-lg border border-white/10 bg-white/5 px-4 py-3 backdrop-blur-md transition-all hover:border-white/20 hover:bg-white/10"
                    >
                      {/* Project Info */}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-white">
                          {project.name || 'Untitled Project'}
                        </p>

                        <div className="mt-0.5 flex items-center gap-3">
                          {updatedAt && (
                            <span className="flex items-center gap-1 text-xs text-zinc-300">
                              <ClockIcon size={10} />

                              {moment(updatedAt).fromNow()}
                            </span>
                          )}

                          {project.version !== undefined && (
                            <span className="text-xs font-medium text-white/60">
                              v{project.version}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="ml-4 flex items-center gap-2">
                        <button
                          type="button"
                          aria-label={`Delete ${
                            project.name || 'project'
                          }`}
                          onClick={(event) =>
                            handleProjectDelete(
                              event,
                              project._id
                            )
                          }
                          className="cursor-pointer rounded-md p-1.5 text-zinc-200 opacity-0 transition-all hover:bg-white/10 hover:text-red-400 group-hover:opacity-100"
                        >
                          <Trash2Icon size={14} />
                        </button>

                        <ArrowRightIcon
                          size={14}
                          className="text-zinc-200 transition-colors group-hover:text-white"
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          {/* Empty State */}
          {!loadingProjects && projects.length === 0 && (
            <div className="mt-12 w-full rounded-xl border border-white/10 bg-white/5 p-8 text-center backdrop-blur-md">
              <p className="text-sm font-medium text-white">
                No projects yet
              </p>

              <p className="mt-1 text-xs text-white/50">
                Describe your idea above to create your first project.
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

export default HomePage
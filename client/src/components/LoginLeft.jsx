import React from 'react'

const LoginLeft = () => {
  return (
    <div className="hidden lg:flex lg:w-2/5 bg-[url('/bg-img.png')] bg-cover bg-center bg-no-repeat flex-col justify-between p-12 shrink-0 select-none">
      
<div className="flex items-center gap-4">
  <img
    src="/logo.svg"
    alt="Haiweb Logo"
    className="size-12"
  />

  <span className="text-4xl font-medium text-white">
    HAI Builder
  </span>
</div>

      <div>
        <h2 className="text-[32px] font-normal leading-tight tracking-tight text-white">
          Build your presence on the web
        </h2>

        <p className="text-zinc-300 mt-5 max-w-3xl text-lg leading-relaxed">
          Describe what you need, preview instantly, and customize your website
          in real-time. React with clean JSX, verified layouts, and instant code
          exports.
        </p>

        <p className="text-zinc-300 text-sm mt-14">
          Copyright © {new Date().getFullYear()} HAI Builder. All rights reserved.
        </p>
      </div>

    </div>
  )
}

export default LoginLeft
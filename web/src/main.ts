import './style.css'

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) {
  throw new Error('#app mount point not found')
}

const heading = document.createElement('h1')
heading.className = 'placeholder-heading'
heading.textContent = 'Taste Test'

const subtitle = document.createElement('p')
subtitle.className = 'placeholder-subtitle'
subtitle.textContent = 'This-or-that album ranking. Pick loop arrives in plan 02-03.'

app.append(heading, subtitle)

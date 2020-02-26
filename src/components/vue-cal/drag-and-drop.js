// @todo:
// OK - emit an event-drop event
// OK - handle drag and drop and splits / highlight splits separately
// OK - add split in emitted event
// OK - check that event.draggable = false prevents dragging
// OK - check edge and IE
// OK - also go to narrower view from month view
// OK - Fix drag image not visible on Safari
// OK - Support drag over today button
// OK - drop an event that would start before last midnight
// OK - Prevent dragging background events
// OK - Allow dragging timeless events
//    - modularize this file
//    - add javadoc

const holdOverTimeout = 800 // How long we should hold over an element before it reacts.
let changeViewTimeout = null
let pressPrevOrNextInterval = null
let viewBeforeDrag = { id: null, date: null } // To go back if cancelling.
let viewChanged = false
let cancelViewChange = true
let dragOverCell = { el: null, cell: null, timeout: null }

export const eventDragStart = (e, event, vuecal) => {
  // Cancel the drag if event has draggable set to false and trying to drag a text selection.
  if (e.target.nodeType === 3) return e.preventDefault()

  e.dataTransfer.setData('text', '...') // Without this the drag will not happen in Firefox.
  e.dataTransfer.dropEffect = 'move'

  const { clickHoldAnEvent, dragAnEvent } = vuecal.domEvents
  // Remove delete button if held for too long.
  setTimeout(() => {
    clickHoldAnEvent._eid = null
    clearTimeout(clickHoldAnEvent.timeoutId)
    event.deleting = false
  }, 0)

  dragAnEvent._eid = event._eid
  event.dragging = true
  event.draggingStatic = true
  viewBeforeDrag = { id: vuecal.view.id, date: vuecal.view.startDate }

  const { minutes } = vuecal.minutesAtCursor(e)
  // When click and drag an event the cursor can be anywhere in the event,
  // when later dropping the event, we need to subtract the cursor position in the event.
  dragAnEvent.cursorGrabAt = minutes - event.startTimeMinutes

  cancelViewChange = true // Re-init the cancel view: should cancel unless a cell received the event.
}

export const eventDragEnd = (e, event, vuecal) => {
  const { dragAnEvent } = vuecal.domEvents
  dragAnEvent._eid = null
  event.dragging = false
  event.draggingStatic = false

  // When dropping the event, cancel view change if no cell received the event (in cellDragDrop).
  if (viewChanged && cancelViewChange && viewBeforeDrag.id) vuecal.switchView(viewBeforeDrag.id, viewBeforeDrag.date, true)
}

export const cellDragEnter = (e, cell, cellDate, vuecal) => {
  const target = e.currentTarget

  // Cancel dragEnter event if hovering a child.
  if (e.currentTarget.contains(e.relatedTarget)) return
  if (target === dragOverCell.el || !target.className.includes('vuecal__cell-content')) return false

  // Un-highlight the previous cell.
  if (dragOverCell.el) dragOverCell.cell.highlighted = false

  dragOverCell = { el: target, cell, timeout: clearTimeout(dragOverCell.timeout) }
  cell.highlighted = true

  // On `years`, `year` & `month` views, go to narrower view on drag and hold.
  if (['years', 'year', 'month'].includes(vuecal.view.id)) {
    dragOverCell.timeout = setTimeout(() => vuecal.switchToNarrowerView(cellDate), 2000)
  }
}

// When starting to drag event on the same cell it's in.
export const cellDragOver = (e, cell, cellDate, vuecal, split) => {
  e.preventDefault()
  cell.highlighted = true
  if (split || split === 0) cell.highlightedSplit = split
}

// Warning: cell dragleave event happens AFTER another cell dragenter!
export const cellDragLeave = (e, cell, cellDate, vuecal) => {
  e.preventDefault()

  if (e.currentTarget.contains(e.relatedTarget)) return

  cell.highlightedSplit = false

  // Only cancel the timer if leaving the current cell to no other one.
  // If leaving this cell to enter another, a cancel is done in cellDragEnter,
  // and a new timer is started.
  if (dragOverCell.cell === cell) {
    clearTimeout(dragOverCell.timeout)
    cell.highlighted = false
    dragOverCell = { el: null, cell: null, timeout: null }
  }
}

export const cellDragDrop = (e, cell, cellDate, vuecal, split) => {
  // Needed to prevent navigation to the text set in dataTransfer from eventDragStart().
  e.preventDefault()

  const { view, domEvents: { dragAnEvent }, mutableEvents, minutesAtCursor } = vuecal

  // Find the dragged event from its _eid in the view or mutableEvents array.
  let event = view.events.find(e => e._eid === dragAnEvent._eid)
  const eventInView = !!event
  if (!event) event = mutableEvents.find(e => e._eid === dragAnEvent._eid) || {}

  // Modify the event start and end date.
  const { startDate: oldDate, split: oldSplit } = event
  const eventDuration = event.endTimeMinutes - event.startTimeMinutes
  // Force the start of the event at previous midnight minimum.
  const startTimeMinutes = Math.max(minutesAtCursor(e).minutes - dragAnEvent.cursorGrabAt, 0)
  event.startTimeMinutes = startTimeMinutes
  event.startDate = new Date(new Date(cellDate).setMinutes(startTimeMinutes))
  event.start = `${event.startDate.format()} ${event.startDate.formatTime()}`
  // Force the end of the event at next midnight maximum.
  event.endTimeMinutes = Math.min(startTimeMinutes + eventDuration, 24 * 60)
  event.endDate = new Date(new Date(cellDate).setMinutes(event.endTimeMinutes))
  event.end = `${event.endDate.format()} ${event.endDate.formatTime()}`

  event.dragging = false
  if (split || split === 0) event.split = split
  if (!eventInView) vuecal.addEventsToView([event])

  cell.highlighted = false
  cell.highlightedSplit = null
  cancelViewChange = false

  const params = {
    event: vuecal.cleanupEvent(event),
    oldDate,
    newDate: event.startDate,
    ...((split || split === 0) && { oldSplit, newSplit: split })
  }
  vuecal.$emit('event-drop', params)
}

// On drag enter on a view button or on prev & next buttons.
export const viewSelectorDragEnter = (e, id, vuecal, headerData) => {
  if (e.currentTarget.contains(e.relatedTarget)) return

  headerData.highlightedControl = id
  clearTimeout(changeViewTimeout)
  changeViewTimeout = setTimeout(() => {
    if (['previous', 'next'].includes(id)) {
      vuecal[id]()
      // Keep pressing on previous or next button until user goes away.
      clearInterval(pressPrevOrNextInterval)
      pressPrevOrNextInterval = setInterval(vuecal[id], holdOverTimeout)
    }
    else if (id === 'today') {
      clearInterval(pressPrevOrNextInterval)
      let viewId
      if (vuecal.view.id.includes('year')) {
        viewId = Object.entries(vuecal.views).find(([vid, obj]) => obj.enabled && !vid.includes('year'))[0]
      }
      vuecal.switchView(viewId || vuecal.view.id, new Date(new Date().setHours(0, 0, 0, 0)), true)
    }
    else vuecal.switchView(id, null, true)
    viewChanged = true
  }, holdOverTimeout)
}

export const viewSelectorDragLeave = (e, id, vuecal, headerData) => {
  if (e.currentTarget.contains(e.relatedTarget)) return

  // Only cancel the timer if leaving the current nav button to no other one.
  // If leaving this nav button to enter another, a cancel is done in viewSelectorDragEnter,
  // and a new timer is started.
  if (headerData.highlightedControl === id) {
    headerData.highlightedControl = null
    if (changeViewTimeout) changeViewTimeout = clearTimeout(changeViewTimeout)
    if (pressPrevOrNextInterval) pressPrevOrNextInterval = clearInterval(pressPrevOrNextInterval)
  }
}

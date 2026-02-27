import React, { useState, useEffect } from 'react';
import { X, ChevronLeft, ChevronRight, Save, Trash2, Plus, Calendar, Check, DollarSign, Cake } from 'lucide-react';

// Event Types Configuration (Constant)
const EVENT_TYPES = {
    appointment: { label: 'Appointment', color: 'bg-blue-500', borderColor: 'border-blue-500/50', ringColor: 'ring-blue-500/50', icon: <Calendar size={18} className="text-orange-500" />, defaultRecurrence: 'none' },
    bill: { label: 'Bill', color: 'bg-red-500', borderColor: 'border-red-500/50', ringColor: 'ring-red-500/50', icon: <DollarSign size={18} className="text-orange-500" />, defaultRecurrence: 'monthly' },
    birthday: { label: 'Birthday', color: 'bg-purple-500', borderColor: 'border-purple-500/50', ringColor: 'ring-purple-500/50', icon: <Cake size={18} className="text-orange-500" />, defaultRecurrence: 'yearly', locked: true }
};

// Helper to generate time slots (15 min intervals) in AM/PM format
const generateTimeSlots = () => {
    const slots = [];
    for (let i = 0; i < 24 * 4; i++) {
        const h = Math.floor(i / 4);
        const m = (i % 4) * 15;
        const date = new Date();
        date.setHours(h, m, 0, 0);
        slots.push(date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }));
    }
    return slots;
};

const TIME_SLOTS = generateTimeSlots();

// Helper to add duration to time string (AM/PM)
const addDuration = (timeStr, minutes) => {
    if (!timeStr) return '';
    // Parse "09:00 AM"
    const [time, modifier] = timeStr.split(' ');
    let [h, m] = time.split(':').map(Number);

    if (modifier === 'PM' && h !== 12) h += 12;
    if (modifier === 'AM' && h === 12) h = 0;

    const date = new Date();
    date.setHours(h, m + minutes, 0, 0);
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
};

// Helper: Convert AM/PM time to minutes for sorting
const timeToMinutes = (timeStr) => {
    if (!timeStr) return -1;
    const [time, modifier] = timeStr.split(' ');
    let [h, m] = time.split(':').map(Number);
    if (modifier === 'PM' && h !== 12) h += 12;
    if (modifier === 'AM' && h === 12) h = 0;
    return h * 60 + m;
};

const CalendarOverlay = ({ isOpen, onClose, initialDate }) => {
    // ... (component start)

    // ... (rest of component)


    const [viewDate, setViewDate] = useState(new Date());
    // const [selectedDate, setSelectedDate] = useState(null); // Removed: caused sticky date bug
    const [events, setEvents] = useState([]);
    const [viewMode, setViewMode] = useState('month'); // 'month', 'week', 'day'

    // Open directly to date if provided
    useEffect(() => {
        if (isOpen && initialDate) {
            // setSelectedDate(initialDate); // Removed
            setViewDate(new Date(initialDate + 'T00:00:00'));
            setViewMode('day'); // Open in day view if strict date provided

            // Reset editor when opening fresh from icon
            setEditingEventId(null);
            setTitleInput('');
            setDescInput('');
            setAmountInput('');
            setIsPaid(false);
            setStartTime('');
            setEndTime('');
            setRepeatOption('none');
            setEventType('appointment');
        }
    }, [isOpen, initialDate]);

    // Handle Escape Key
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape' && isOpen) {
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    // Editor State
    const [titleInput, setTitleInput] = useState('');
    const [descInput, setDescInput] = useState('');
    const [amountInput, setAmountInput] = useState('');
    const [isPaid, setIsPaid] = useState(false);
    const [startTime, setStartTime] = useState('');
    const [endTime, setEndTime] = useState('');
    const [repeatOption, setRepeatOption] = useState('none');
    const [editingEventId, setEditingEventId] = useState(null);
    const [eventType, setEventType] = useState('appointment');

    const handleStartTimeChange = (newStartTime) => {
        setStartTime(newStartTime);
        // Auto-set End Time to +1 hour if not already set or if it was the default duration
        // For simplicity, always update end time to start + 1 hour when start changes, 
        // unless the user intentionally sets end time afterwards (which we can't easily track without more state).
        // Let's just strict auto-set for now as requested ("auto-set End Time (+1h)").
        setEndTime(addDuration(newStartTime, 60));
    };

    // ... existing saveEvent, etc ...



    const handleTypeChange = (type) => {
        setEventType(type);
        const config = EVENT_TYPES[type];
        if (config.defaultRecurrence) {
            setRepeatOption(config.defaultRecurrence);
        }
    };

    const handleEditClick = (ev) => {
        setEditingEventId(ev.id);
        // Fallback for legacy events that only had 'text'
        setTitleInput(ev.title || ev.text || '');
        setDescInput(ev.description || '');
        setAmountInput(ev.amount || '');
        setIsPaid(ev.isPaid || false);
        setStartTime(ev.startTime || '');
        setEndTime(ev.endTime || '');
        setRepeatOption(ev.recurrence);
        setEventType(ev.type || 'appointment');
    };

    const cancelEdit = () => {
        setEditingEventId(null);
        setTitleInput('');
        setDescInput('');
        setAmountInput('');
        setIsPaid(false);
        setStartTime('');
        setEndTime('');
        const defaultType = 'appointment';
        setEventType(defaultType);
        setRepeatOption(EVENT_TYPES[defaultType].defaultRecurrence);
    };

    // Load Events (and migrate old format if needed)
    useEffect(() => {
        const loadEvents = () => {
            const saved = localStorage.getItem('zulu7_calendar_events');
            if (saved) {
                try {
                    const parsed = JSON.parse(saved);
                    // Check if it's the old format (not an array)
                    if (!Array.isArray(parsed)) {
                        const migrated = Object.entries(parsed).map(([date, text]) => ({
                            id: Date.now() + Math.random(),
                            date,
                            title: text, // Migrate text to title
                            description: '',
                            recurrence: 'none'
                        }));
                        setEvents(migrated);
                    } else {
                        // Ensure legacy array items also have title
                        const normalized = parsed.map(ev => ({
                            ...ev,
                            title: ev.title || ev.text || 'Untitled Event',
                            description: ev.description || '',
                            amount: ev.amount || '',
                            isPaid: ev.isPaid || false,
                            startTime: ev.startTime || '',
                            endTime: ev.endTime || ''
                        }));
                        setEvents(normalized);
                    }
                } catch { /* ignore */ }
            } else {
                // Check for old notes key from previous version
                const oldNotes = localStorage.getItem('zulu7_calendar_notes');
                if (oldNotes) {
                    try {
                        const parsed = JSON.parse(oldNotes);
                        const migrated = Object.entries(parsed).map(([date, text]) => ({
                            id: Date.now() + Math.random(),
                            date,
                            title: text,
                            description: '',
                            recurrence: 'none'
                        }));
                        setEvents(migrated);
                    } catch { /* ignore */ }
                }
            }
        };
        loadEvents();
    }, [isOpen]);

    const saveEvent = () => {
        // Use current view date (always correct for Day view)
        const targetDate = `${viewDate.getFullYear()}-${String(viewDate.getMonth() + 1).padStart(2, '0')}-${String(viewDate.getDate()).padStart(2, '0')}`;

        if (!targetDate || !titleInput.trim()) return;

        const eventData = {
            id: editingEventId || Date.now(),
            date: targetDate,
            title: titleInput,
            description: descInput,
            amount: eventType === 'bill' ? amountInput : '',
            isPaid: eventType === 'bill' ? isPaid : false,
            startTime: eventType === 'appointment' ? startTime : '',
            endTime: eventType === 'appointment' ? endTime : '',
            recurrence: repeatOption,
            type: eventType
        };

        let updatedEvents;
        if (editingEventId) {
            // Update Existing
            updatedEvents = events.map(e =>
                e.id === editingEventId
                    ? eventData
                    : e
            );
            setEditingEventId(null);
        } else {
            // Create New
            updatedEvents = [...events, eventData];
        }

        setEvents(updatedEvents);
        localStorage.setItem('zulu7_calendar_events', JSON.stringify(updatedEvents));
        window.dispatchEvent(new Event('calendar-updated'));

        setTitleInput('');
        setDescInput('');
        setAmountInput('');
        setIsPaid(false);
        setStartTime('');
        setEndTime('');
        // Reset to default state
        const defaultType = 'appointment';
        setEventType(defaultType);
        setRepeatOption(EVENT_TYPES[defaultType].defaultRecurrence);
    };

    const deleteEvent = (id) => {
        const updatedEvents = events.filter(e => e.id !== id);
        setEvents(updatedEvents);
        localStorage.setItem('zulu7_calendar_events', JSON.stringify(updatedEvents));
        window.dispatchEvent(new Event('calendar-updated'));
    };

    // Helper: Check if event occurs on date
    const getEventsForDate = (targetDateStr) => {
        // const target = new Date(targetDateStr + 'T00:00:00'); // Unused
        const [tY, tM, tD] = targetDateStr.split('-').map(Number);

        return events.filter(e => {
            const [sY, sM, sD] = e.date.split('-').map(Number);

            // Optimization: If event starts AFTER target, ignore
            if (sY > tY || (sY === tY && sM > tM) || (sY === tY && sM === tM && sD > tD)) return false;

            if (e.recurrence === 'none') {
                return e.date === targetDateStr;
            }
            if (e.recurrence === 'daily') return true;
            if (e.recurrence === 'weekly') {
                const start = new Date(e.date);
                const current = new Date(targetDateStr);
                const diffTime = Math.abs(current - start);
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                return diffDays % 7 === 0;
            }
            if (e.recurrence === 'biweekly') {
                const start = new Date(e.date);
                const current = new Date(targetDateStr);
                const diffTime = Math.abs(current - start);
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                return diffDays % 14 === 0;
            }
            if (e.recurrence === 'monthly') {
                return sD === tD;
            }
            if (e.recurrence === 'monthly_1st') {
                return tD === 1;
            }
            if (e.recurrence === 'monthly_15th') {
                return tD === 15;
            }
            if (e.recurrence === 'yearly') {
                return sD === tD && sM === tM;
            }
            return false;
        }).sort((a, b) => {
            // Sort by start time using helper
            if (a.startTime && b.startTime) return timeToMinutes(a.startTime) - timeToMinutes(b.startTime);
            return 0;
        });
    };

    // Helper to safely get event config
    const getEventConfig = (type) => EVENT_TYPES[type] || EVENT_TYPES.appointment;

    if (!isOpen) return null;

    const year = viewDate.getFullYear();
    const month = viewDate.getMonth(); // 0-11

    // Helpers for Month View
    const firstDayOfMonth = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const monthNames = ["January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"];

    const today = new Date();
    const isToday = (d) => {
        return d === today.getDate() && month === today.getMonth() && year === today.getFullYear();
    };

    const handlePrev = () => {
        const newDate = new Date(viewDate);
        if (viewMode === 'month') {
            newDate.setMonth(newDate.getMonth() - 1);
            newDate.setDate(1);
        } else if (viewMode === 'week') {
            newDate.setDate(newDate.getDate() - 7);
        } else if (viewMode === 'day') {
            newDate.setDate(newDate.getDate() - 1);
        }
        setViewDate(newDate);
    };

    const handleNext = () => {
        const newDate = new Date(viewDate);
        if (viewMode === 'month') {
            newDate.setMonth(newDate.getMonth() + 1);
            newDate.setDate(1);
        } else if (viewMode === 'week') {
            newDate.setDate(newDate.getDate() + 7);
        } else if (viewMode === 'day') {
            newDate.setDate(newDate.getDate() + 1);
        }
        setViewDate(newDate);
    };

    const handleDayClick = (day) => {
        const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        // If clicking a day in month view, switch to day view for that day
        setViewDate(new Date(dateKey + 'T00:00:00'));
        setViewMode('day');

        // Reset editor
        setEditingEventId(null);
        setTitleInput('');
        setDescInput('');
        setAmountInput('');
        setIsPaid(false);
        setStartTime('');
        setEndTime('');
        setRepeatOption('none');
        setEventType('appointment');
    };

    // Helper to get day events for the Expanded View based on viewDate in Day Mode
    // Or selectedDate for backward compatibility if needed, but we should unify around viewMode
    const currentDayKey = `${viewDate.getFullYear()}-${String(viewDate.getMonth() + 1).padStart(2, '0')}-${String(viewDate.getDate()).padStart(2, '0')}`;
    const selectedDayEvents = getEventsForDate(currentDayKey);

    const getWeekDays = () => {
        const startOfWeek = new Date(viewDate);
        const day = startOfWeek.getDay();
        const diff = startOfWeek.getDate() - day; // adjust when day is sunday
        startOfWeek.setDate(diff);

        const days = [];
        for (let i = 0; i < 7; i++) {
            const d = new Date(startOfWeek);
            d.setDate(startOfWeek.getDate() + i);
            days.push(d);
        }
        return days;
    };
    const weekDays = getWeekDays();

    // Calculate Bill Totals
    const calculateBillTotals = () => {
        let relevantEvents = [];

        if (viewMode === 'month') {
            // Get all days in month
            for (let d = 1; d <= daysInMonth; d++) {
                const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                relevantEvents = [...relevantEvents, ...getEventsForDate(dateKey)];
            }
        } else if (viewMode === 'week') {
            weekDays.forEach(d => {
                const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                relevantEvents = [...relevantEvents, ...getEventsForDate(dateKey)];
            });
        } else if (viewMode === 'day') {
            relevantEvents = selectedDayEvents;
        }

        const due = relevantEvents
            .filter(e => e.type === 'bill' && e.amount && !e.isPaid)
            .reduce((sum, e) => sum + parseFloat(e.amount || 0), 0);

        const paid = relevantEvents
            .filter(e => e.type === 'bill' && e.amount && e.isPaid)
            .reduce((sum, e) => sum + parseFloat(e.amount || 0), 0);

        return { due: due.toFixed(2), paid: paid.toFixed(2) };
    };

    const { due: totalDue, paid: totalPaid } = calculateBillTotals();

    // Helper for card content
    const renderEventCardContent = (ev) => (
        <div className={ev.isPaid ? 'opacity-50' : ''}>
            <div className="text-xs font-bold truncate flex items-center">
                <span className="mr-1">{getEventConfig(ev.type).icon}</span>
                <span className={ev.isPaid ? 'line-through decoration-white/50' : ''}>
                    {ev.title || ev.text}
                </span>
                {ev.isPaid && <span className="ml-1 text-[8px] uppercase bg-green-500/20 text-green-400 px-1 rounded-none">Paid</span>}
            </div>
            {ev.type === 'appointment' && (ev.startTime || ev.endTime) && (
                <div className="text-[10px] mt-1 opacity-80 font-mono">
                    {ev.startTime}
                </div>
            )}
            {ev.type === 'bill' && ev.amount && (
                <div className={`text-[10px] mt-1 font-bold ${ev.isPaid ? 'text-red-400/50 line-through' : 'text-white/90'}`}>
                    ${parseFloat(ev.amount).toFixed(2)}
                </div>
            )}
        </div>
    );

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-8 bg-black/80 backdrop-blur-xl animate-in fade-in duration-200">
            {/* Main Calendar Container */}
            <div className={`w-full h-full max-w-7xl bg-black/40 border border-white/10 rounded-none overflow-hidden flex flex-col shadow-2xl transition-all duration-300`}>

                {/* Header */}
                {/* Header */}
                <div className="flex items-center justify-between p-6 bg-white/5 border-b border-white/5">
                    <div className="flex items-center space-x-6">
                        {/* Navigation */}
                        <div className="flex items-center space-x-2">
                            <button onClick={handlePrev} title="Previous" className="p-2 hover:bg-white/10 rounded-none text-white transition-colors cursor-pointer"><ChevronLeft size={24} /></button>
                            <button onClick={handleNext} title="Next" className="p-2 hover:bg-white/10 rounded-none text-white transition-colors cursor-pointer"><ChevronRight size={24} /></button>
                        </div>

                        {/* Title */}
                        <div
                            onClick={() => setViewMode('month')}
                            title="Switch to Month View"
                            className="flex flex-col cursor-pointer hover:opacity-80 transition-opacity group"
                        >
                            {viewMode === 'month' && (
                                <h2 className="text-3xl font-light tracking-tight">
                                    <span className="font-bold text-orange-500">{monthNames[month]}</span> <span className="text-white">{year}</span>
                                </h2>
                            )}
                            {viewMode === 'week' && (
                                <h2 className="text-3xl font-light tracking-tight">
                                    <span className="font-bold text-orange-500">{monthNames[weekDays[0].getMonth()]}</span> <span className="text-white">{weekDays[0].getFullYear()}</span>
                                </h2>
                            )}
                            {viewMode === 'day' && (
                                <h2 className="text-3xl font-light tracking-tight">
                                    <span className="font-bold text-orange-500">{viewDate.toLocaleDateString('en-US', { weekday: 'long' })}</span> <span className="text-white ml-2">{viewDate.getDate()} {monthNames[viewDate.getMonth()]}</span> <span className="text-orange-500 ml-2">{year}</span>
                                </h2>
                            )}
                        </div>
                    </div>

                    {/* Right Side Controls */}
                    <div className="flex items-center space-x-4">
                        {/* Bill Total Badge */}
                        {(parseFloat(totalDue) > 0 || parseFloat(totalPaid) > 0) && (
                            <div className="flex items-center animate-in fade-in slide-in-from-left-2">
                                <span className="bg-red-500/10 px-4 py-1.5 rounded-none border border-red-500/20 text-sm font-bold text-red-400 shadow-sm border-white/5 flex items-center space-x-2">
                                    <span>Bills Due:</span>
                                    {parseFloat(totalPaid) > 0 && (
                                        <span className="line-through opacity-50 decoration-red-400/50 mr-1 text-white/50">
                                            ${totalPaid}
                                        </span>
                                    )}
                                    <span>${totalDue}</span>
                                </span>
                            </div>
                        )}

                        {/* View Switcher */}
                        <div className="flex bg-black/40 rounded-none p-1 border border-white/10">
                            {['month', 'week', 'day'].map((m) => (
                                <button
                                    key={m}
                                    onClick={() => {
                                        setViewMode(m);
                                        setViewDate(new Date());
                                    }}
                                    title={`Switch to ${m} view`}
                                    className={`
                                        cursor-pointer px-4 py-1.5 rounded-none text-sm font-bold capitalize transition-all
                                        ${viewMode === m ? 'bg-white/20 text-white shadow-sm' : 'text-white/40 hover:text-white hover:bg-white/5'}
                                    `}
                                >
                                    {m}
                                </button>
                            ))}
                        </div>

                        <button
                            onClick={onClose}
                            title="Close Calendar"
                            className="p-3 text-white/50 hover:text-orange-500 hover:bg-white/10 rounded-none transition-all cursor-pointer"
                        >
                            <X size={24} />
                        </button>
                    </div>
                </div>

                {/* Content Area */}
                <div className="flex-1 bg-white/5 overflow-hidden flex flex-col relative">

                    {/* MONTH VIEW */}
                    {viewMode === 'month' && (
                        <div className="flex-1 grid grid-cols-7 grid-rows-[auto_1fr] h-full">
                            {/* Week Header */}
                            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                                <div key={day} className="p-4 text-white/40 text-sm font-bold uppercase tracking-wider text-center border-b border-r border-white/5">
                                    {day}
                                </div>
                            ))}

                            {/* Days */}
                            <div className="col-span-7 grid grid-cols-7 auto-rows-fr overflow-y-auto">
                                {/* Empty Padding Days */}
                                {Array.from({ length: firstDayOfMonth }).map((_, i) => (
                                    <div key={`empty-${i}`} className="border-r border-b border-white/5 bg-black/20" />
                                ))}

                                {/* Actual Days */}
                                {Array.from({ length: daysInMonth }).map((_, i) => {
                                    const day = i + 1;
                                    const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                                    const dayEvents = getEventsForDate(dateKey);
                                    // const isSelected = currentDayKey === dateKey; // Unused

                                    // Calculate daily bill totals
                                    const dailyDue = dayEvents
                                        .filter(e => e.type === 'bill' && e.amount && !e.isPaid)
                                        .reduce((sum, e) => sum + parseFloat(e.amount || 0), 0);

                                    const dailyPaid = dayEvents
                                        .filter(e => e.type === 'bill' && e.amount && e.isPaid)
                                        .reduce((sum, e) => sum + parseFloat(e.amount || 0), 0);

                                    return (
                                        <div
                                            key={day}
                                            onClick={() => handleDayClick(day)}
                                            title={`View ${monthNames[month]} ${day}`}
                                            className={`
                                                relative p-4 border-r border-b border-white/5 group cursor-pointer transition-colors min-h-[120px]
                                                ${isToday(day) ? 'bg-blue-500/10' : 'hover:bg-white/5'}
                                            `}
                                        >
                                            <div className="flex justify-between items-center">
                                                <span className={`text-2xl font-light ${isToday(day) ? 'text-blue-400 font-bold' : 'text-white/70'}`}>
                                                    {day}
                                                </span>
                                                <div className="flex flex-col items-end">
                                                    {dailyPaid > 0 && (
                                                        <span className="text-xs font-bold text-white/30 line-through">
                                                            ${dailyPaid.toFixed(2)}
                                                        </span>
                                                    )}
                                                    {dailyDue > 0 && (
                                                        <span className="text-lg font-bold text-red-400">
                                                            ${dailyDue.toFixed(2)}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>

                                            <div className="mt-2 space-y-1">
                                                {dayEvents.slice(0, 3).map((ev, idx) => (
                                                    <div key={idx} className="flex items-center justify-between cursor-pointer" title={ev.title || ev.text}>
                                                        <div className="flex items-center min-w-0">
                                                            <span className="mr-1 text-[10px] grayscale-0">{getEventConfig(ev.type).icon}</span>
                                                            <span className={`text-[10px] font-medium truncate ${getEventConfig(ev.type).color.replace('bg-', 'text-')}`}>
                                                                {ev.title || ev.text}
                                                            </span>
                                                        </div>
                                                        {ev.type === 'bill' && ev.amount && (
                                                            <span className={`text-[9px] font-bold ml-1 ${ev.isPaid ? 'text-red-400/50 line-through' : 'text-red-400'}`}>
                                                                ${ev.amount}
                                                            </span>
                                                        )}
                                                    </div>
                                                ))}
                                                {dayEvents.length > 3 && (
                                                    <div className="text-[9px] text-white/30 pl-3">+{dayEvents.length - 3} more</div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* WEEK VIEW */}
                    {viewMode === 'week' && (
                        <div className="flex-1 grid grid-cols-1 md:grid-cols-7 h-full divide-y md:divide-y-0 md:divide-x divide-white/10 overflow-y-auto md:overflow-visible">
                            {weekDays.map((d, i) => {
                                const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                                const dayEvents = getEventsForDate(dateKey);
                                const isCurrentDay = d.getDate() === today.getDate() && d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();

                                return (
                                    <div key={i} title={`View ${d.toLocaleDateString()}`} className="flex flex-row md:flex-col h-auto md:h-full hover:bg-white/5 transition-colors group min-h-[100px] md:min-h-0 border-b md:border-b-0 border-white/5 md:border-transparent cursor-pointer" onClick={() => {
                                        setViewDate(d);
                                        setViewMode('day');
                                    }}>
                                        {/* Header */}
                                        <div className={`p-4 text-center border-r md:border-r-0 md:border-b border-white/10 w-24 md:w-auto flex flex-col justify-center md:block ${isCurrentDay ? 'bg-blue-500/10' : ''}`}>
                                            <div className="text-xs font-bold uppercase text-white/40 tracking-wider mb-1">
                                                {d.toLocaleDateString('en-US', { weekday: 'short' })}
                                            </div>
                                            <div className={`text-2xl font-light ${isCurrentDay ? 'text-blue-400 font-bold' : 'text-white'}`}>
                                                {d.getDate()}
                                            </div>
                                        </div>

                                        <div className="flex-1 p-2 space-y-2 overflow-y-auto">
                                            {dayEvents.map(ev => (
                                                <div key={ev.id} title={ev.title || ev.text} className={`p-2 rounded-none border border-white/10 bg-white/5 text-white shadow-sm cursor-pointer relative overflow-hidden text-left hover:bg-white/10 transition-colors`}>
                                                    <div className={`absolute top-0 left-0 bottom-0 w-1 ${getEventConfig(ev.type).color}`}></div>
                                                    {renderEventCardContent(ev)}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* DAY VIEW (Formerly Modal) */}
                    {viewMode === 'day' && (
                        <div className="flex-1 flex flex-col md:flex-row overflow-hidden animate-in fade-in duration-300">
                            {/* Left: Event List */}
                            <div className="flex-1 border-r border-white/10 p-4 overflow-y-auto">
                                <h4 className="text-xs font-bold text-white/30 uppercase tracking-widest mb-4">Events ({selectedDayEvents.length})</h4>
                                {selectedDayEvents.length === 0 && (
                                    <div className="text-center py-10 text-white/20 italic">No events scheduled</div>
                                )}
                                <div className="space-y-3">
                                    {selectedDayEvents.map(ev => (
                                        <div
                                            key={ev.id}
                                            onClick={() => handleEditClick(ev)}
                                            className={`
                                                p-4 rounded-none border cursor-pointer transition-all group relative overflow-hidden
                                                ${editingEventId === ev.id
                                                    ? `bg-white/10 ${getEventConfig(ev.type).borderColor || 'border-blue-500/50'} ring-1 ${getEventConfig(ev.type).ringColor || 'ring-blue-500/50'}`
                                                    : 'bg-white/5 border-white/5 hover:bg-white/10'}
                                            `}
                                            title="Click to Edit"
                                        >
                                            <div className={`absolute top-0 left-0 bottom-0 w-1 ${getEventConfig(ev.type).color}`}></div>
                                            <div className="flex justify-between items-start pl-2">
                                                <div className="w-full">
                                                    <div className="flex justify-between items-start">
                                                        <div className="text-white font-medium text-lg leading-tight mb-1 flex items-center">
                                                            <span className="mr-2 text-xl">{getEventConfig(ev.type).icon}</span>
                                                            <span>{ev.title || ev.text}</span>
                                                            {ev.type === 'bill' && ev.amount && (
                                                                <span className={`ml-2 font-bold text-sm bg-red-500/10 px-2 py-0.5 rounded-none border border-red-500/20 ${ev.isPaid ? 'text-red-400/50 line-through border-red-500/10 bg-red-500/5' : 'text-red-400'}`}>
                                                                    ${parseFloat(ev.amount).toFixed(2)}
                                                                </span>
                                                            )}
                                                        </div>

                                                        {ev.type === 'appointment' && (ev.startTime || ev.endTime) && (
                                                            <span className="text-blue-300 bg-blue-500/10 px-2 py-0.5 rounded-none text-xs font-mono">
                                                                {ev.startTime || '?'} - {ev.endTime || '?'}
                                                            </span>
                                                        )}
                                                    </div>

                                                    {ev.description && (
                                                        <div className="text-white/40 text-xs mb-2 pl-7 line-clamp-2">{ev.description}</div>
                                                    )}
                                                    <div className="flex items-center space-x-2 pl-7">
                                                        <span className={`text-[10px] px-1.5 py-0.5 rounded-none text-black font-bold uppercase ${getEventConfig(ev.type).color.replace('bg-', 'bg-')}`}>
                                                            {getEventConfig(ev.type).label}
                                                        </span>
                                                        {ev.recurrence !== 'none' && (
                                                            <span className="text-[10px] text-white/40 uppercase border border-white/10 px-1.5 py-0.5 rounded-none">
                                                                {ev.recurrence}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); deleteEvent(ev.id); }}
                                                    className="text-white/10 hover:text-red-400 p-2 transition-colors ml-2 cursor-pointer"
                                                    title="Delete Event"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Right: Add/Edit Form */}
                            <div className="w-full md:w-96 p-6 bg-white/[0.02] flex flex-col border-t md:border-t-0 md:border-l border-white/10">
                                <h4 className={`text-base font-bold mb-6 flex items-center ${editingEventId ? 'text-blue-400' : 'text-white'}`}>
                                    {editingEventId ? 'Edit Event' : 'Add New Event'}
                                </h4>

                                <div className="space-y-4 flex-1 overflow-y-auto min-h-0 pr-1">
                                    {/* Type Selector */}
                                    <div className="grid grid-cols-3 gap-2">
                                        {Object.entries(EVENT_TYPES).map(([key, config]) => (
                                            <button
                                                key={key}
                                                onClick={() => handleTypeChange(key)}
                                                className={`
                                                    flex flex-col items-center justify-center p-3 rounded-none border transition-all cursor-pointer relative overflow-hidden
                                                    ${eventType === key
                                                        ? 'bg-white/10 border-white/10 text-white shadow-lg'
                                                        : 'bg-white/5 border-white/10 text-white/50 hover:bg-white/10'}
                                                `}
                                                title={`Create ${config.label} Event`}
                                            >
                                                {eventType === key && (
                                                    <div className={`absolute top-0 left-0 bottom-0 w-1 ${config.color}`}></div>
                                                )}
                                                <span className="text-xl mb-1">{config.icon}</span>
                                                <span className="text-[9px] font-bold uppercase">{config.label}</span>
                                            </button>
                                        ))}
                                    </div>

                                    {/* Title Input */}
                                    <div>
                                        <label className="block text-xs text-white/40 font-bold uppercase tracking-wider mb-2">Title</label>
                                        <input
                                            type="text"
                                            value={titleInput}
                                            onChange={(e) => setTitleInput(e.target.value)}
                                            className="w-full bg-black/40 text-white text-lg font-bold border border-white/10 rounded-none p-3 outline-none focus:border-blue-500/50 transition-colors placeholder-white/20"
                                            placeholder={eventType === 'birthday' ? "John's Birthday" : "Event Title"}
                                        />
                                    </div>

                                    {/* Bill Amount Input */}
                                    {eventType === 'bill' && (
                                        <div className="animate-in fade-in slide-in-from-top-2 space-y-3">
                                            <div>
                                                <label className="block text-xs text-white/40 font-bold uppercase tracking-wider mb-2">Amount ($)</label>
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    value={amountInput}
                                                    onChange={(e) => setAmountInput(e.target.value)}
                                                    className="w-full bg-black/40 text-white text-lg font-bold border border-white/10 rounded-none p-3 outline-none focus:border-red-500/50 transition-colors placeholder-white/20"
                                                    placeholder="0.00"
                                                />
                                            </div>
                                            <div
                                                onClick={() => setIsPaid(!isPaid)}
                                                className={`
                                                    flex items-center space-x-3 p-3 rounded-none border cursor-pointer transition-all
                                                    ${isPaid ? 'bg-green-500/20 border-green-500/50' : 'bg-white/5 border-white/10 hover:bg-white/10'}
                                                `}
                                                title="Toggle Paid Status"
                                            >
                                                <div className={`
                                                    w-5 h-5 rounded-none border flex items-center justify-center transition-colors
                                                    ${isPaid ? 'bg-green-500 border-green-500 text-black' : 'border-white/30 text-transparent'}
                                                `}>
                                                    <Check size={14} strokeWidth={4} />
                                                </div>
                                                <span className={`text-sm font-bold ${isPaid ? 'text-green-400' : 'text-white/50'}`}>
                                                    Mark as Paid
                                                </span>
                                            </div>
                                        </div>
                                    )}

                                    {/* Time Inputs (Only for Appointments) */}
                                    {eventType === 'appointment' && (
                                        <div className="grid grid-cols-2 gap-3 animate-in fade-in slide-in-from-top-2">
                                            <div>
                                                <label className="block text-xs text-white/40 font-bold uppercase tracking-wider mb-2">Start Time</label>
                                                <select
                                                    value={startTime}
                                                    onChange={(e) => handleStartTimeChange(e.target.value)}
                                                    className="w-full bg-black/40 text-white text-sm font-bold border border-white/10 rounded-none p-3 outline-none focus:border-blue-500/50 appearance-none cursor-pointer"
                                                >
                                                    <option value="">Select...</option>
                                                    {TIME_SLOTS.map(t => (
                                                        <option key={t} value={t}>{t}</option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-xs text-white/40 font-bold uppercase tracking-wider mb-2">End Time</label>
                                                <select
                                                    value={endTime}
                                                    onChange={(e) => setEndTime(e.target.value)}
                                                    className="w-full bg-black/40 text-white text-sm font-bold border border-white/10 rounded-none p-3 outline-none focus:border-blue-500/50 appearance-none cursor-pointer"
                                                >
                                                    <option value="">Select...</option>
                                                    {TIME_SLOTS.map(t => (
                                                        <option key={t} value={t}>{t}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        </div>
                                    )}

                                    {/* Description */}
                                    <div>
                                        <label className="block text-xs text-white/40 font-bold uppercase tracking-wider mb-2">Description <span className="text-white/20 font-normal normal-case">(Optional)</span></label>
                                        <textarea
                                            value={descInput}
                                            onChange={(e) => setDescInput(e.target.value)}
                                            className="w-full h-24 bg-black/40 text-white/80 text-sm border border-white/10 rounded-none p-3 outline-none focus:border-blue-500/50 resize-none transition-colors"
                                            placeholder="Add details..."
                                        />
                                    </div>

                                    {/* Recurrence */}
                                    <div>
                                        <label className="block text-xs text-white/40 font-bold uppercase tracking-wider mb-2">Repeats</label>

                                        {EVENT_TYPES[eventType].locked ? (
                                            <div className="w-full bg-white/5 text-white/50 text-sm border border-white/5 rounded-none p-3 flex items-center">
                                                <span className="mr-2">🔒</span>
                                                <span>Automatically set to <span className="text-white font-bold capitalize">{EVENT_TYPES[eventType].defaultRecurrence}</span></span>
                                            </div>
                                        ) : (
                                            <select
                                                value={repeatOption}
                                                onChange={(e) => setRepeatOption(e.target.value)}
                                                className="w-full bg-black/40 text-white text-sm border border-white/10 rounded-none p-3 outline-none focus:border-blue-500/50 appearance-none cursor-pointer"
                                            >
                                                <option value="none">Never (One-time)</option>
                                                <option value="daily">Daily</option>
                                                <option value="weekly">Weekly</option>
                                                <option value="biweekly">Every 2 Weeks</option>
                                                <option value="monthly">Monthly (Same Date)</option>
                                                <option value="monthly_1st">Monthly (on the 1st)</option>
                                                <option value="monthly_15th">Monthly (on the 15th)</option>
                                                <option value="yearly">Yearly</option>
                                            </select>
                                        )}
                                    </div>
                                </div>

                                {/* Actions */}
                                <div className="flex items-center space-x-3 mt-6 pt-6 border-t border-white/10">
                                    {editingEventId && (
                                        <button
                                            onClick={cancelEdit}
                                            title="Cancel Edit"
                                            className="flex-1 py-3 rounded-none border border-white/10 text-white/60 hover:text-white hover:bg-white/5 text-sm font-bold transition-all cursor-pointer"
                                        >
                                            Cancel
                                        </button>
                                    )}
                                    <button
                                        onClick={saveEvent}
                                        disabled={!(titleInput || '').trim()}
                                        title={!(titleInput || '').trim() ? "Enter a title to save" : (editingEventId ? "Update Event" : "Save Event")}
                                        className={`
                                            flex-1 py-3 rounded-none text-white text-sm font-bold shadow-lg transition-all flex items-center justify-center space-x-2
                                            ${!(titleInput || '').trim() ? 'bg-white/5 text-white/20 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-500 cursor-pointer'}
                                        `}
                                    >
                                        <Save size={16} />
                                        <span>{editingEventId ? 'Update' : 'Save'}</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default CalendarOverlay;

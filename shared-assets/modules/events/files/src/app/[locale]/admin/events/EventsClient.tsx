"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Trash2, Plus, Calendar, MapPin, Globe, Pencil, X, Check } from "lucide-react";

export default function EventsClient({ events: initialEvents }: { events: any[] }) {
  const [events, setEvents] = useState(initialEvents);
  const [loading, setLoading] = useState(false);
  const [newEvent, setNewEvent] = useState({ name: "", location: "", date_info: "", website_url: "" });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: "", location: "", date_info: "", website_url: "" });
  const router = useRouter();

  async function handleAdd() {
    if (!newEvent.name || !newEvent.location) return;
    setLoading(true);
    
    const { data, error } = await supabase
      .from("shop_events")
      .insert([newEvent])
      .select()
      .single();

    if (!error && data) {
      setEvents([...events, data]);
      setNewEvent({ name: "", location: "", date_info: "", website_url: "" });
      router.refresh();
    }
    setLoading(false);
  }

  async function handleUpdate() {
    if (!editingId || !editForm.name || !editForm.location) return;
    setLoading(true);

    const { error } = await supabase
      .from("shop_events")
      .update(editForm)
      .eq("id", editingId);

    if (!error) {
      setEvents(events.map(e => e.id === editingId ? { ...e, ...editForm } : e));
      setEditingId(null);
      router.refresh();
    }
    setLoading(false);
  }

  function startEditing(event: any) {
    setEditingId(event.id);
    setEditForm({
      name: event.name || "",
      location: event.location || "",
      date_info: event.date_info || "",
      website_url: event.website_url || ""
    });
  }

  async function handleDelete(id: string) {
    if (!confirm("Are you sure?")) return;
    setLoading(true);
    const { error } = await supabase.from("shop_events").delete().eq("id", id);
    if (!error) {
      setEvents(events.filter(e => e.id !== id));
      router.refresh();
    }
    setLoading(false);
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label>Event Name</Label>
              <Input 
                value={newEvent.name} 
                onChange={e => setNewEvent({...newEvent, name: e.target.value})}
                placeholder="e.g. Dutch Chili Fest"
              />
            </div>
            <div className="space-y-2">
              <Label>Location</Label>
              <Input 
                value={newEvent.location} 
                onChange={e => setNewEvent({...newEvent, location: e.target.value})}
                placeholder="e.g. Eindhoven, NL"
              />
            </div>
            <div className="space-y-2">
              <Label>Date Info</Label>
              <Input 
                value={newEvent.date_info} 
                onChange={e => setNewEvent({...newEvent, date_info: e.target.value})}
                placeholder="e.g. April 12th"
              />
            </div>
            <div className="space-y-2">
              <Label>Website URL</Label>
              <div className="flex gap-2">
                <Input 
                  value={newEvent.website_url} 
                  onChange={e => setNewEvent({...newEvent, website_url: e.target.value})}
                  placeholder="https://..."
                />
                <Button onClick={handleAdd} disabled={loading || !newEvent.name || !newEvent.location}>
                  <Plus className="h-4 w-4 mr-2" /> Add
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {events.map((event) => (
          <Card key={event.id}>
            <CardContent className="pt-6">
              {editingId === event.id ? (
                <div className="space-y-3">
                  <Input
                    value={editForm.name}
                    onChange={e => setEditForm({...editForm, name: e.target.value})}
                    placeholder="Name"
                  />
                  <Input
                    value={editForm.location}
                    onChange={e => setEditForm({...editForm, location: e.target.value})}
                    placeholder="Location"
                  />
                  <Input
                    value={editForm.date_info}
                    onChange={e => setEditForm({...editForm, date_info: e.target.value})}
                    placeholder="Date Info"
                  />
                  <Input
                    value={editForm.website_url}
                    onChange={e => setEditForm({...editForm, website_url: e.target.value})}
                    placeholder="Website URL"
                  />
                  <div className="flex gap-2 pt-2">
                    <Button size="sm" className="flex-1" onClick={handleUpdate} disabled={loading}>
                      <Check className="h-4 w-4 mr-1" /> Save
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setEditingId(null)} disabled={loading}>
                      <X className="h-4 w-4 mr-1" /> Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <Calendar size={16} className="text-brand-red" />
                      <p className="font-bold text-sm leading-tight">{event.name}</p>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-zinc-500">
                      <MapPin size={14} />
                      <span>{event.location}</span>
                    </div>
                    {event.date_info && (
                      <p className="text-xs font-semibold text-brand-red ml-6">{event.date_info}</p>
                    )}
                    {event.website_url && (
                      <div className="flex items-center gap-2 text-[10px] text-zinc-400 mt-1 ml-6">
                        <Globe size={12} />
                        <span className="truncate max-w-[120px]">{event.website_url}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-1">
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-8 w-8 text-zinc-400 hover:text-brand-red"
                      onClick={() => startEditing(event)}
                      disabled={loading}
                    >
                      <Pencil size={14} />
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-8 w-8 text-zinc-400 hover:text-red-600"
                      onClick={() => handleDelete(event.id)}
                      disabled={loading}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
